import { Modal } from "antd";

interface PDFPreviewProps {
  open: boolean;
  title?: string;
  pdfUrl?: string;
  onClose: () => void;
}

export function PDFPreview({ open, title = "Xem trước phiếu", pdfUrl, onClose }: PDFPreviewProps) {
  return (
    <Modal open={open} title={title} width={1000} footer={null} onCancel={onClose} destroyOnClose>
      {pdfUrl ? (
        <iframe src={pdfUrl} title="pdf-preview" width="100%" height={680} style={{ border: 0 }} />
      ) : (
        <div>Không có dữ liệu PDF</div>
      )}
    </Modal>
  );
}
