import Link from "next/link";
import styles from "./page.module.css";

const MOCK_DOCS = [
  { id: "1", name: "Invoice-Q1-2024.pdf", date: "Mar 15, 2024", pages: 2, status: "extracted" },
  { id: "2", name: "Contract-Vendor-XYZ.pdf", date: "Mar 10, 2024", pages: 8, status: "extracted" },
  { id: "3", name: "Report-Annual-2023.pdf", date: "Feb 28, 2024", pages: 24, status: "extracted" },
  { id: "4", name: "Receipt-Mar-01.png", date: "Mar 1, 2024", pages: 1, status: "extracted" },
];

export default function DocumentsPage() {
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Documents</h1>
          <p className={styles.subtitle}>All your scanned documents.</p>
        </div>
        <Link href="/dashboard/scan" className={styles.btnPrimary}>
          + New Scan
        </Link>
      </div>

      <div className={styles.table}>
        <div className={styles.tableHeader}>
          <div>Name</div>
          <div>Date</div>
          <div>Pages</div>
          <div>Status</div>
          <div />
        </div>
        {MOCK_DOCS.map((doc) => (
          <div key={doc.id} className={styles.tableRow}>
            <div className={styles.docName}>
              <span className={styles.docIcon}>◇</span>
              {doc.name}
            </div>
            <div className={styles.docDate}>{doc.date}</div>
            <div className={styles.docPages}>{doc.pages}</div>
            <div className={styles.docStatus}>
              <span className={styles.statusBadge}>✓ Extracted</span>
            </div>
            <div className={styles.docActions}>
              <button className={styles.actionBtn}>View</button>
              <button className={styles.actionBtn}>Export</button>
            </div>
          </div>
        ))}
      </div>

      <p className={styles.note}>
        Demo data — scan a real document on the{" "}
        <Link href="/dashboard/scan" className={styles.link}>
          Scan page
        </Link>
        .
      </p>
    </div>
  );
}
