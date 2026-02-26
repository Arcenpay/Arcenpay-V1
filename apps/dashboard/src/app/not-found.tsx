export default function NotFound() {
  return (
    <div style={{ textAlign: "center", padding: "100px 20px" }}>
      <h1 style={{ fontSize: 48, fontWeight: 700 }}>404</h1>
      <p style={{ color: "var(--text-secondary)", marginTop: 8 }}>
        Page not found
      </p>
      <a
        href="/"
        style={{
          color: "var(--primary)",
          marginTop: 16,
          display: "inline-block",
        }}
      >
        Back to Dashboard
      </a>
    </div>
  );
}
