export const printElement = (elementId: string) => {
  const el = document.getElementById(elementId);
  if (!el) return;
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><title>Print</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; color: #1a1a1a; }
      table { width: 100%; border-collapse: collapse; margin: 16px 0; }
      th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 13px; }
      th { background: #f5f5f5; font-weight: 600; }
      h1, h2 { margin: 0 0 8px; }
      .text-right { text-align: right; }
      .header { border-bottom: 2px solid #333; padding-bottom: 8px; margin-bottom: 16px; }
    </style></head><body>${el.innerHTML}</body></html>`);
  win.document.close();
  win.print();
};
