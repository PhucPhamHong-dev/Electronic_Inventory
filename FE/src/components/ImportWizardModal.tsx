import { CloseOutlined, DownloadOutlined, InboxOutlined, QuestionCircleOutlined, SearchOutlined } from "@ant-design/icons";
import { Badge, Button, Input, InputNumber, Modal, Radio, Select, Space, Steps, Table, Tag, Typography, Upload, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import type { ImportMode, ImportValidationResponse, ImportValidationRow, RawImportRecord } from "../services/masterData.api";

const IMPORT_MODE_OPTIONS: Array<{ value: ImportMode; label: string; note: string }> = [
  {
    value: "CREATE_ONLY",
    label: "Thêm mới",
    note: "Dữ liệu chưa có trong hệ thống sẽ được thêm mới, dữ liệu đã có sẽ bỏ qua."
  },
  {
    value: "UPDATE_ONLY",
    label: "Cập nhật",
    note: "Chỉ cập nhật các mã đã có sẵn trong hệ thống."
  },
  {
    value: "UPSERT",
    label: "Ghi đè",
    note: "Nếu chưa có sẽ thêm mới, nếu đã có sẽ cập nhật."
  }
];

export interface ImportSystemField<TMapped extends object> {
  key: Extract<keyof TMapped, string>;
  label: string;
  required?: boolean;
  aliases?: string[];
  renderValue?: (value: TMapped[keyof TMapped]) => string;
  description?: string;
}

interface ImportWizardModalProps<TMapped extends object> {
  open: boolean;
  title: string;
  entityLabel: string;
  systemFields: Array<ImportSystemField<TMapped>>;
  onCancel: () => void;
  onValidate: (input: {
    jsonData: RawImportRecord[];
    mappingObject: Partial<Record<Extract<keyof TMapped, string>, string>>;
    importMode: ImportMode;
  }) => Promise<ImportValidationResponse<TMapped>>;
  onCommit: (input: {
    rows: Array<ImportValidationRow<TMapped>>;
    importMode: ImportMode;
  }) => Promise<{ processed: number; inserted: number; updated: number }>;
  onCompleted: () => Promise<void> | void;
}

interface WorkbookExtractResult {
  headers: string[];
  rows: RawImportRecord[];
  sheetNames: string[];
  activeSheetName: string;
  headerRowNumber: number;
}

interface ValidationErrorInsight {
  message: string;
  count: number;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreHeader(fieldLabel: string, aliases: string[], header: string): number {
  const normalizedHeader = normalizeText(header);
  const normalizedLabel = normalizeText(fieldLabel);
  const normalizedAliases = aliases.map((alias) => normalizeText(alias));

  if (normalizedHeader === normalizedLabel || normalizedAliases.includes(normalizedHeader)) {
    return 100;
  }

  const candidates = [normalizedLabel, ...normalizedAliases];
  let score = 0;
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (normalizedHeader.includes(candidate) || candidate.includes(normalizedHeader)) {
      score = Math.max(score, Math.min(candidate.length, normalizedHeader.length) * 10);
    }
    const candidateTokens = new Set(candidate.split(" ").filter(Boolean));
    const headerTokens = new Set(normalizedHeader.split(" ").filter(Boolean));
    let common = 0;
    candidateTokens.forEach((token) => {
      if (headerTokens.has(token)) {
        common += 1;
      }
    });
    if (common > 0) {
      score = Math.max(score, common * 15);
    }
  }
  return score;
}

async function extractWorkbookData(
  file: File,
  preferredSheetName?: string,
  preferredHeaderRowNumber?: number
): Promise<WorkbookExtractResult> {
  const detectHeaderRow = (matrix: Array<Array<string | number | boolean | null>>): number => {
    if (!matrix.length) {
      return 0;
    }

    let bestIndex = 0;
    let bestScore = -1;
    const maxScanRows = Math.min(matrix.length, 25);

    for (let rowIndex = 0; rowIndex < maxScanRows; rowIndex += 1) {
      const row = matrix[rowIndex] ?? [];
      const normalized = row.map((cell) => String(cell ?? "").trim()).filter((cell) => cell.length > 0);
      if (normalized.length < 2) {
        continue;
      }

      const textualCount = normalized.filter((cell) => /[A-Za-zÀ-ỹ]/u.test(cell)).length;
      const score = normalized.length * 5 + textualCount * 3 - rowIndex * 0.1;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = rowIndex;
      }
    }

    return bestIndex;
  };

  const buildUniqueHeaders = (rawHeaders: Array<string | number | boolean | null>): string[] => {
    const seen = new Map<string, number>();
    return rawHeaders.map((value, index) => {
      const baseHeader = String(value ?? "").trim() || `Column_${index + 1}`;
      const current = seen.get(baseHeader) ?? 0;
      seen.set(baseHeader, current + 1);
      if (current === 0) {
        return baseHeader;
      }
      return `${baseHeader}_${current + 1}`;
    });
  };

  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const fallbackSheetName = workbook.SheetNames[0];
  const activeSheetName = preferredSheetName && workbook.SheetNames.includes(preferredSheetName)
    ? preferredSheetName
    : fallbackSheetName;

  if (!activeSheetName) {
    return { headers: [], rows: [], sheetNames: [], activeSheetName: "", headerRowNumber: 1 };
  }

  const sheet = workbook.Sheets[activeSheetName];
  const matrix = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(sheet, { header: 1, defval: null });
  const safeHeaderRowIndex = preferredHeaderRowNumber && Number.isFinite(preferredHeaderRowNumber)
    ? Math.max(0, Math.min(matrix.length - 1, preferredHeaderRowNumber - 1))
    : detectHeaderRow(matrix);
  const headers = buildUniqueHeaders(matrix[safeHeaderRowIndex] ?? []);
  const rows: RawImportRecord[] = matrix
    .slice(safeHeaderRowIndex + 1)
    .map((cells) => {
      const record: RawImportRecord = {};
      headers.forEach((header, index) => {
        record[header] = cells[index] ?? null;
      });
      return record;
    })
    .filter((row) => Object.values(row).some((value) => value !== null && String(value).trim() !== ""));

  return {
    headers,
    rows,
    sheetNames: workbook.SheetNames,
    activeSheetName,
    headerRowNumber: safeHeaderRowIndex + 1
  };
}

function downloadTemplate(fileName: string, headers: string[]): void {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([headers]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Mẫu cơ bản");
  XLSX.writeFile(workbook, fileName);
}

function splitErrorNote(errorNote: string): string[] {
  return errorNote
    .split(";")
    .map((item) => item.trim())
    .filter((item) => Boolean(item));
}

export function ImportWizardModal<TMapped extends object>(props: ImportWizardModalProps<TMapped>) {
  const { open, title, entityLabel, systemFields, onCancel, onValidate, onCommit, onCompleted } = props;
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [excelHeaders, setExcelHeaders] = useState<string[]>([]);
  const [fileData, setFileData] = useState<RawImportRecord[]>([]);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheetName, setActiveSheetName] = useState("");
  const [headerRowNumber, setHeaderRowNumber] = useState(1);
  const [columnMapping, setColumnMapping] = useState<Partial<Record<Extract<keyof TMapped, string>, string>>>({});
  const [validationResults, setValidationResults] = useState<ImportValidationResponse<TMapped> | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>("UPSERT");
  const [busy, setBusy] = useState(false);
  const [mappingSearch, setMappingSearch] = useState("");
  const [showAllMapping, setShowAllMapping] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"ALL" | "VALID" | "INVALID">("ALL");
  const [commitResult, setCommitResult] = useState<{ processed: number; inserted: number; updated: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setCurrentStep(0);
      setSelectedFile(null);
      setSelectedFileName("");
      setExcelHeaders([]);
      setFileData([]);
      setSheetNames([]);
      setActiveSheetName("");
      setHeaderRowNumber(1);
      setColumnMapping({});
      setValidationResults(null);
      setImportMode("UPSERT");
      setBusy(false);
      setMappingSearch("");
      setShowAllMapping(true);
      setStatusFilter("ALL");
      setCommitResult(null);
    }
  }, [open]);

  const activeImportMode = IMPORT_MODE_OPTIONS.find((option) => option.value === importMode);

  const filteredMappingFields = useMemo(() => {
    const keyword = mappingSearch.trim().toLowerCase();
    return systemFields.filter((field) => {
      const visibleByRequired = showAllMapping ? true : Boolean(field.required);
      const visibleByKeyword = keyword
        ? normalizeText(field.label).includes(normalizeText(keyword))
        : true;
      return visibleByRequired && visibleByKeyword;
    });
  }, [mappingSearch, showAllMapping, systemFields]);

  const filteredValidationRows = useMemo(() => {
    const rows = validationResults?.rows ?? [];
    if (statusFilter === "VALID") {
      return rows.filter((row) => row.status === "valid");
    }
    if (statusFilter === "INVALID") {
      return rows.filter((row) => row.status === "invalid");
    }
    return rows;
  }, [statusFilter, validationResults]);

  const validationGuidance = useMemo(() => {
    const invalidRows = (validationResults?.rows ?? []).filter((row) => row.status === "invalid");
    const errorCounter = new Map<string, number>();
    let rowsWithDuplicate = 0;
    let rowsWithMissingForUpdate = 0;
    let rowsWithPaymentStatusError = 0;
    let rowsWithDateError = 0;

    for (const row of invalidRows) {
      const errorMessages = splitErrorNote(row.errorNote);
      const uniqueMessages = new Set(errorMessages.length > 0 ? errorMessages : ["Dữ liệu không hợp lệ"]);

      for (const messageText of uniqueMessages) {
        errorCounter.set(messageText, (errorCounter.get(messageText) ?? 0) + 1);

        const normalizedMessage = normalizeText(messageText);
        if (normalizedMessage.includes("da ton tai")) {
          rowsWithDuplicate += 1;
        }
        if (normalizedMessage.includes("chua ton tai de cap nhat")) {
          rowsWithMissingForUpdate += 1;
        }
        if (normalizedMessage.includes("trang thai thanh toan")) {
          rowsWithPaymentStatusError += 1;
        }
        if (normalizedMessage.includes("ngay") && normalizedMessage.includes("khong hop le")) {
          rowsWithDateError += 1;
        }
      }
    }

    const topErrors: ValidationErrorInsight[] = [...errorCounter.entries()]
      .map(([message, count]) => ({ message, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 6);

    const suggestedModes: ImportMode[] = [];
    let modeHint = "";

    if (importMode === "CREATE_ONLY" && rowsWithDuplicate > 0) {
      modeHint = "Nhiều dòng báo “đã tồn tại”. Bạn nên chuyển sang Ghi đè hoặc Cập nhật rồi kiểm tra lại.";
      suggestedModes.push("UPSERT", "UPDATE_ONLY");
    }

    if (importMode === "UPDATE_ONLY" && rowsWithMissingForUpdate > 0) {
      modeHint = "Nhiều dòng báo “chưa tồn tại để cập nhật”. Bạn nên chuyển sang Ghi đè hoặc Thêm mới rồi kiểm tra lại.";
      suggestedModes.push("UPSERT", "CREATE_ONLY");
    }

    const uniqueSuggestedModes = Array.from(new Set(suggestedModes));

    return {
      topErrors,
      modeHint,
      suggestedModes: uniqueSuggestedModes,
      rowsWithPaymentStatusError,
      rowsWithDateError
    };
  }, [importMode, validationResults]);

  const mappingColumns = useMemo<ColumnsType<ImportSystemField<TMapped>>>(() => [
    {
      title: "Thông tin bắt buộc",
      dataIndex: "required",
      key: "required",
      width: 160,
      align: "center",
      render: (_, field) => (field.required ? <input type="checkbox" checked readOnly /> : <input type="checkbox" readOnly />)
    },
    {
      title: "Cột trên phần mềm",
      key: "systemField",
      width: 260,
      render: (_, field) => field.label
    },
    {
      title: "Cột trên tệp dữ liệu",
      key: "mapping",
      width: 320,
      render: (_, field) => (
        <Select
          allowClear
          placeholder="Chọn cột trên Excel"
          style={{ width: "100%" }}
          value={columnMapping[field.key]}
          options={excelHeaders.map((header) => ({ value: header, label: header }))}
          onChange={(value) => {
            setColumnMapping((current) => ({
              ...current,
              [field.key]: value
            }));
          }}
        />
      )
    },
    {
      title: "Diễn giải",
      key: "description",
      render: (_, field) => field.description || field.label
    }
  ], [columnMapping, excelHeaders]);

  const previewColumns = useMemo<ColumnsType<ImportValidationRow<TMapped>>>(() => {
    const mappedColumns: ColumnsType<ImportValidationRow<TMapped>> = systemFields.map((field) => ({
      title: field.label,
      key: field.key,
      render: (_, record) => {
        const value = record.mappedData[field.key as keyof TMapped];
        if (field.renderValue) {
          return field.renderValue(value);
        }
        if (value === null || value === undefined || value === "") {
          return "-";
        }
        return String(value);
      }
    }));

    return [
      {
        title: "Dòng số",
        dataIndex: "rowNumber",
        key: "rowNumber",
        width: 90,
        align: "center"
      },
      {
        title: "Tình trạng",
        key: "status",
        width: 140,
        render: (_, record) => (
          <span className={record.status === "valid" ? "import-status-valid" : "import-status-invalid"}>
            {record.status === "valid" ? "Hợp lệ" : "Không hợp lệ"}
          </span>
        )
      },
      {
        title: "Chi tiết lỗi",
        dataIndex: "errorNote",
        key: "errorNote",
        width: 260,
        render: (value: string) => {
          const errorMessages = splitErrorNote(value);
          if (errorMessages.length === 0) {
            return "";
          }
          return (
            <div className="misa-import__error-note">
              {errorMessages.map((item, index) => (
                <div key={`${item}-${index}`}>{item}</div>
              ))}
            </div>
          );
        }
      },
      ...mappedColumns
    ];
  }, [systemFields]);

  const stepItems = [
    { title: "CHỌN TỆP NGUỒN" },
    { title: "GHÉP DỮ LIỆU" },
    { title: "KIỂM TRA DỮ LIỆU" },
    { title: "KẾT QUẢ" }
  ];

  const applyAutoMapping = (headers: string[]) => {
    const nextMapping: Partial<Record<Extract<keyof TMapped, string>, string>> = {};
    for (const field of systemFields) {
      let bestHeader = "";
      let bestScore = 0;
      for (const header of headers) {
        const score = scoreHeader(field.label, field.aliases ?? [], header);
        if (score > bestScore) {
          bestHeader = header;
          bestScore = score;
        }
      }
      if (bestHeader && bestScore >= 20) {
        nextMapping[field.key] = bestHeader;
      }
    }
    setColumnMapping(nextMapping);
  };

  const loadFile = async (file: File, preferredSheetName?: string, preferredHeaderRowNumber?: number) => {
    const parsed = await extractWorkbookData(file, preferredSheetName, preferredHeaderRowNumber);
    setSelectedFile(file);
    setSelectedFileName(file.name);
    setExcelHeaders(parsed.headers);
    setFileData(parsed.rows);
    setSheetNames(parsed.sheetNames);
    setActiveSheetName(parsed.activeSheetName);
    setHeaderRowNumber(parsed.headerRowNumber);
    setValidationResults(null);
    setCommitResult(null);
    applyAutoMapping(parsed.headers);
    return parsed;
  };

  const handleBeforeUpload = async (file: File) => {
    try {
      const parsed = await loadFile(file);
      if (parsed.rows.length === 0) {
        message.warning("File Excel chưa có dữ liệu để import.");
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Không đọc được file Excel.");
    }
    return false;
  };

  const runValidation = async () => {
    if (fileData.length === 0) {
      message.warning("Vui lòng chọn file Excel trước.");
      return;
    }

    const missingRequired = systemFields
      .filter((field) => field.required && !columnMapping[field.key])
      .map((field) => field.label);
    if (missingRequired.length > 0) {
      message.warning(`Bạn chưa ghép cột bắt buộc: ${missingRequired.join(", ")}`);
      return;
    }

    setBusy(true);
    try {
      const result = await onValidate({
        jsonData: fileData,
        mappingObject: columnMapping,
        importMode
      });
      setValidationResults(result);
      setCurrentStep(2);
    } finally {
      setBusy(false);
    }
  };

  const handleNext = async () => {
    if (currentStep === 0) {
      if (fileData.length === 0) {
        message.warning("Vui lòng chọn tệp nguồn.");
        return;
      }
      setCurrentStep(1);
      return;
    }

    if (currentStep === 1) {
      await runValidation();
    }
  };

  const handleCommit = async () => {
    if (!validationResults) {
      message.warning("Bạn cần kiểm tra dữ liệu trước khi nhập.");
      return;
    }

    setBusy(true);
    try {
      const result = await onCommit({
        rows: validationResults.rows.filter((row) => row.status === "valid"),
        importMode
      });
      setCommitResult(result);
      await onCompleted();
      setCurrentStep(3);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      width="100vw"
      open={open}
      title={null}
      destroyOnClose
      onCancel={onCancel}
      closable={false}
      maskClosable={false}
      footer={null}
      className="misa-import-modal"
      style={{ top: 0, paddingBottom: 0, maxWidth: "100vw" }}
      styles={{ body: { padding: 0, height: "100vh" } }}
    >
      <div className="misa-import">
        <div className="misa-import__header">
          <div className="misa-import__title">{title}</div>
          <Space size={18}>
            <QuestionCircleOutlined className="misa-import__header-icon" />
            <CloseOutlined className="misa-import__header-icon" onClick={onCancel} />
          </Space>
        </div>

        <div className="misa-import__steps">
          <Steps current={currentStep} items={stepItems} labelPlacement="vertical" />
        </div>

        <div className="misa-import__body">
          {currentStep === 0 ? (
            <div className="misa-import__source">
              <div className="misa-import__source-left">
                <div className="misa-import__section-title">Chọn tệp Excel</div>
                <div className="misa-import__section-hint">Dung lượng tối đa 20MB</div>

                <Upload.Dragger beforeUpload={handleBeforeUpload} maxCount={1} accept=".xlsx,.xls" showUploadList={false} className="misa-import__dragger">
                  <div className="misa-import__dragger-box">
                    <InboxOutlined className="misa-import__dragger-icon" />
                    {selectedFileName ? (
                      <div className="misa-import__file-name">{selectedFileName}</div>
                    ) : (
                      <div className="misa-import__dragger-text">Kéo thả tệp vào đây hoặc bấm vào đây</div>
                    )}
                  </div>
                </Upload.Dragger>

                <Space size={20} className="misa-import__template-links">
                  <Button
                    type="link"
                    icon={<DownloadOutlined />}
                    onClick={() => downloadTemplate(`Mau_${entityLabel.replace(/\s+/g, "_")}_co_ban.xlsx`, systemFields.filter((field) => field.required).map((field) => field.label))}
                  >
                    Tải tệp mẫu cơ bản
                  </Button>
                  <Button
                    type="link"
                    icon={<DownloadOutlined />}
                    onClick={() => downloadTemplate(`Mau_${entityLabel.replace(/\s+/g, "_")}_day_du.xlsx`, systemFields.map((field) => field.label))}
                  >
                    Tải tệp mẫu đầy đủ
                  </Button>
                </Space>

                <div className="misa-import__source-grid">
                  <div>
                    <div className="misa-import__field-label">Sheet chứa dữ liệu</div>
                    <Select
                      value={activeSheetName || undefined}
                      options={sheetNames.map((sheetName) => ({ value: sheetName, label: sheetName }))}
                      disabled={!selectedFile}
                      onChange={(value) => {
                        if (!selectedFile) {
                          return;
                        }
                        void loadFile(selectedFile, value, headerRowNumber);
                      }}
                    />
                  </div>
                  <div>
                    <div className="misa-import__field-label">Dòng tiêu đề là dòng số</div>
                    <InputNumber
                      value={headerRowNumber}
                      min={1}
                      style={{ width: "100%" }}
                      disabled={!selectedFile}
                      onChange={(value) => {
                        const nextValue = typeof value === "number" ? value : Number(value);
                        if (!selectedFile || !Number.isFinite(nextValue) || nextValue <= 0) {
                          return;
                        }
                        void loadFile(selectedFile, activeSheetName, nextValue);
                      }}
                    />
                  </div>
                </div>

                <div className="misa-import__mode">
                  <div className="misa-import__mode-title">Phương thức nhập</div>
                  <Radio.Group value={importMode} onChange={(event) => setImportMode(event.target.value as ImportMode)}>
                    <Space direction="vertical" size={16}>
                      {IMPORT_MODE_OPTIONS.map((option) => (
                        <Radio key={option.value} value={option.value}>
                          {option.label}
                        </Radio>
                      ))}
                    </Space>
                  </Radio.Group>
                </div>
              </div>

              <div className="misa-import__source-right">
                <div className="misa-import__suggest-title">Gợi ý</div>
                <ul className="misa-import__suggest-list">
                  <li>Tải tệp mẫu cơ bản để nhập những thông tin cơ bản.</li>
                  <li>Tải tệp mẫu đầy đủ để nhập tất cả các thông tin.</li>
                  <li>Các thiết lập trong quá trình nhập sẽ được lưu để sử dụng trong các lần tiếp sau.</li>
                  <li><strong>{activeImportMode?.label}:</strong> {activeImportMode?.note}</li>
                </ul>
              </div>
            </div>
          ) : null}

          {currentStep === 1 ? (
            <div className="misa-import__mapping">
              <div className="misa-import__mapping-toolbar">
                <div className="misa-import__mapping-title">Ghép cột trên phần mềm với cột trên tệp dữ liệu</div>
                <Space>
                  <Input
                    prefix={<SearchOutlined />}
                    placeholder="Nhập từ khóa tìm kiếm"
                    value={mappingSearch}
                    onChange={(event) => setMappingSearch(event.target.value)}
                    style={{ width: 260 }}
                  />
                  <Button onClick={() => setShowAllMapping((value) => !value)}>
                    {showAllMapping ? "Ẩn/hiện thông tin" : "Hiện tất cả"}
                  </Button>
                </Space>
              </div>

              <Table
                rowKey="key"
                size="small"
                bordered
                pagination={false}
                columns={mappingColumns}
                dataSource={filteredMappingFields}
                className="misa-import__table"
              />
            </div>
          ) : null}

          {currentStep === 2 ? (
            <div className="misa-import__validation">
              <div className="misa-import__validation-summary">
                <div className="misa-import__validation-stats">
                  <div className="misa-import__valid-count">{validationResults?.summary.valid ?? 0} dòng dữ liệu {entityLabel.toLowerCase()} hợp lệ</div>
                  <div className="misa-import__invalid-count">{validationResults?.summary.invalid ?? 0} dòng dữ liệu {entityLabel.toLowerCase()} không hợp lệ</div>
                </div>
                <div className="misa-import__validation-filter">
                  <span>Lọc tình trạng</span>
                  <Select
                    value={statusFilter}
                    style={{ width: 150 }}
                    onChange={(value) => setStatusFilter(value)}
                    options={[
                      { value: "ALL", label: "Tất cả" },
                      { value: "VALID", label: "Hợp lệ" },
                      { value: "INVALID", label: "Không hợp lệ" }
                    ]}
                  />
                </div>
              </div>

              {(validationResults?.summary.invalid ?? 0) > 0 ? (
                <div className="misa-import__validation-guide">
                  <div className="misa-import__validation-guide-title">Lý do không hợp lệ và cách xử lý</div>
                  {validationGuidance.modeHint ? (
                    <div className="misa-import__validation-guide-mode">{validationGuidance.modeHint}</div>
                  ) : null}

                  {validationGuidance.suggestedModes.length > 0 ? (
                    <Space wrap>
                      {validationGuidance.suggestedModes.map((modeValue) => {
                        const option = IMPORT_MODE_OPTIONS.find((optionItem) => optionItem.value === modeValue);
                        return (
                          <Button key={modeValue} size="small" onClick={() => setImportMode(modeValue)}>
                            Chuyển sang {option?.label ?? modeValue}
                          </Button>
                        );
                      })}
                      <Button size="small" type="primary" onClick={() => void runValidation()} loading={busy}>
                        Kiểm tra lại
                      </Button>
                    </Space>
                  ) : null}

                  {validationGuidance.topErrors.length > 0 ? (
                    <div className="misa-import__validation-guide-errors">
                      {validationGuidance.topErrors.map((errorItem) => (
                        <div key={errorItem.message} className="misa-import__validation-guide-error-item">
                          <span>{errorItem.message}</span>
                          <Tag color="red">{errorItem.count} dòng</Tag>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {validationGuidance.rowsWithPaymentStatusError > 0 ? (
                    <Typography.Text type="secondary">
                      Trạng thái thanh toán chỉ nhận: <strong>UNPAID</strong>, <strong>PARTIAL</strong>, <strong>PAID</strong>.
                    </Typography.Text>
                  ) : null}
                  {validationGuidance.rowsWithDateError > 0 ? (
                    <Typography.Text type="secondary">
                      Các cột ngày nên dùng định dạng dễ nhận diện như <strong>YYYY-MM-DD</strong> hoặc <strong>DD/MM/YYYY</strong>.
                    </Typography.Text>
                  ) : null}
                </div>
              ) : null}

              <Table
                size="small"
                bordered
                rowKey={(record) => String(record.rowNumber)}
                pagination={{ pageSize: 8 }}
                columns={previewColumns}
                dataSource={filteredValidationRows}
                className="misa-import__table"
                rowClassName={(record) => (record.status === "invalid" ? "import-preview-row-error" : "import-preview-row-valid")}
              />
            </div>
          ) : null}

          {currentStep === 3 ? (
            <div className="misa-import__result">
              <div className="misa-import__result-card">
                <Badge status="success" text="Nhập dữ liệu thành công" />
                <div className="misa-import__result-grid">
                  <div>
                    <div className="misa-import__result-value">{commitResult?.processed ?? 0}</div>
                    <div className="misa-import__result-label">Dòng đã xử lý</div>
                  </div>
                  <div>
                    <div className="misa-import__result-value">{commitResult?.inserted ?? 0}</div>
                    <div className="misa-import__result-label">Thêm mới</div>
                  </div>
                  <div>
                    <div className="misa-import__result-value">{commitResult?.updated ?? 0}</div>
                    <div className="misa-import__result-label">Cập nhật</div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="misa-import__footer">
          <Button className="misa-import__footer-left" onClick={onCancel}>
            {currentStep === 3 ? "Đóng" : "Hủy"}
          </Button>
          <Space>
            {currentStep > 0 && currentStep < 3 ? (
              <Button onClick={() => setCurrentStep((step) => Math.max(step - 1, 0))} disabled={busy}>
                Quay lại
              </Button>
            ) : null}
            {currentStep < 2 ? (
              <Button type="primary" className="misa-import__primary" onClick={() => void handleNext()} loading={busy}>
                Tiếp tục
              </Button>
            ) : null}
            {currentStep === 2 ? (
              <Button
                type="primary"
                className="misa-import__primary"
                onClick={() => void handleCommit()}
                loading={busy}
                disabled={!validationResults || validationResults.summary.valid === 0}
              >
                Nhập dữ liệu
              </Button>
            ) : null}
            {currentStep === 3 ? (
              <Button type="primary" className="misa-import__primary" onClick={onCancel}>
                Hoàn tất
              </Button>
            ) : null}
          </Space>
        </div>
      </div>
    </Modal>
  );
}
