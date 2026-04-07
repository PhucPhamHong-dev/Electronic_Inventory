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

async function extractWorkbookData(file: File, preferredSheetName?: string): Promise<WorkbookExtractResult> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const fallbackSheetName = workbook.SheetNames[0];
  const activeSheetName = preferredSheetName && workbook.SheetNames.includes(preferredSheetName)
    ? preferredSheetName
    : fallbackSheetName;

  if (!activeSheetName) {
    return { headers: [], rows: [], sheetNames: [], activeSheetName: "" };
  }

  const sheet = workbook.Sheets[activeSheetName];
  const matrix = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(sheet, { header: 1, defval: null });
  const headerRow = matrix[0] ?? [];
  const headers = headerRow.map((value) => String(value ?? "").trim()).filter((value) => Boolean(value));
  const rows = XLSX.utils.sheet_to_json<RawImportRecord>(sheet, { defval: null });

  return {
    headers,
    rows,
    sheetNames: workbook.SheetNames,
    activeSheetName
  };
}

function downloadTemplate(fileName: string, headers: string[]): void {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([headers]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Mẫu cơ bản");
  XLSX.writeFile(workbook, fileName);
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
  const [columnMapping, setColumnMapping] = useState<Partial<Record<Extract<keyof TMapped, string>, string>>>({});
  const [validationResults, setValidationResults] = useState<ImportValidationResponse<TMapped> | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>("CREATE_ONLY");
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
      setColumnMapping({});
      setValidationResults(null);
      setImportMode("CREATE_ONLY");
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
        render: (value: string) => value || ""
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

  const loadFile = async (file: File, preferredSheetName?: string) => {
    const parsed = await extractWorkbookData(file, preferredSheetName);
    setSelectedFile(file);
    setSelectedFileName(file.name);
    setExcelHeaders(parsed.headers);
    setFileData(parsed.rows);
    setSheetNames(parsed.sheetNames);
    setActiveSheetName(parsed.activeSheetName);
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
                        void loadFile(selectedFile, value);
                      }}
                    />
                  </div>
                  <div>
                    <div className="misa-import__field-label">Dòng tiêu đề là dòng số</div>
                    <InputNumber value={1} min={1} style={{ width: "100%" }} disabled />
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
