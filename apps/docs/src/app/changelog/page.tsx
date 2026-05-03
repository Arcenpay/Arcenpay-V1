'use client';

export default function ChangelogPage() {
  const updates = [
    {
      version: 'v1.2.0',
      date: 'May 3, 2026',
      title: 'Public docs refresh',
      changes: [
        'Refocused the docs app around the supported public platform surface.',
        'Separated recurring checkout guidance from hosted payment-link guidance.',
        'Removed contract and infrastructure details from the main docs navigation.'
      ]
    },
    {
      version: 'v1.1.0',
      date: 'May 2, 2026',
      title: 'Hosted payment links and invoice improvements',
      changes: [
        'Added Base Sepolia hosted payment links for one-time charges and invoice pay-now flows.',
        'Improved invoice handling and payment-link checkout clarity in the dashboard.',
        'Expanded SDK guidance for hosted payment-link redirects.'
      ]
    },
    {
      version: 'v1.0.0',
      date: 'April 23, 2026',
      title: 'Public platform launch',
      changes: [
        'Released the first public documentation path for dashboard, SDK, and webhook integrations.',
        'Standardized public integrations on Base Sepolia.',
        'Published the React and Node integration guides.'
      ]
    }
  ];

  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">Resources</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>Changelog</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]">
          Product, SDK, and documentation updates that affect public ArcenPay integrations.
        </p>

        <div className="docs-changelog" style={{ marginTop: '40px' }}>
          {updates.map((update, i) => (
            <div key={i} id={update.version} className="docs-changelog-entry" style={{ marginBottom: '64px', position: 'relative', paddingLeft: '32px', borderLeft: '1px solid #f3f4f6' }}>
              <div style={{ position: 'absolute', left: '-5px', top: '8px', width: '9px', height: '9px', borderRadius: '50%', backgroundColor: '#2563eb', border: '2px solid #ffffff' }} />
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#2563eb', marginBottom: '4px' }}>{update.version} — {update.date}</div>
              <h2 style={{ fontSize: '20px', marginTop: '0', marginBottom: '16px' }}>{update.title}</h2>
              <ul style={{ paddingLeft: '20px', color: '#4b5563', lineHeight: '1.6' }}>
                {update.changes.map((change, j) => (
                  <li key={j} style={{ marginBottom: '8px' }}>{change}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">Versions</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          {updates.map((u, i) => (
            <li key={i} className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href={`#${u.version}`}>{u.version}</a></li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
