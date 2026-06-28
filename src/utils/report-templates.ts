
export interface ReportConfig {
  title: string;
  subtitle?: string;
  filters: Record<string, string | number | undefined>;
  generationDate: string;
  instituicaoCabecalhoUrl?: string;
  draft?: boolean;
}

export const getReportBaseHtml = (config: ReportConfig, content: string) => `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${config.title}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @media print {
      .no-print { display: none !important; }
      body { background: white !important; padding: 0 !important; }
      .container { max-width: none !important; width: 100% !important; box-shadow: none !important; border: none !important; }
    }
    body { font-family: 'Inter', sans-serif; background-color: #f4f4f5; position: relative; }
    table { page-break-inside: auto; width: 100%; border-collapse: collapse; }
    tr { page-break-inside: avoid; page-break-after: auto; }
    thead { display: table-header-group; }
    th, td { border-bottom: 1px solid #e5e7eb; }
    
    .watermark {
      position: fixed;
      top: 55%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-40deg);
      opacity: 0.04;
      font-size: 8.5rem;
      font-weight: 900;
      color: #000;
      pointer-events: none;
      white-space: nowrap;
      text-transform: uppercase;
      z-index: 0;
      letter-spacing: 0.1em;
    }
  </style>
</head>
<body class="p-8 relative">
  ${config.draft ? '<div class="watermark no-print" style="opacity: 0.035;">PREVISÃO</div><div class="watermark hidden print:block">PREVISÃO</div>' : ''}
  <div class="max-w-6xl mx-auto bg-white shadow-2xl rounded-2xl overflow-hidden border border-zinc-200 container relative z-10">
    <div class="bg-zinc-900 p-8 text-white flex justify-between items-center no-print">
      <div>
        <h1 class="text-2xl font-black tracking-tight flex items-center gap-2">
          SIS ESCALA
          ${config.draft ? '<span class="text-[9px] font-black uppercase tracking-wider bg-amber-500 text-zinc-950 px-2 py-0.5 rounded">Previsão</span>' : ''}
        </h1>
        <p class="text-zinc-400 text-sm uppercase font-bold tracking-widest">Relatório Consolidado</p>
      </div>
      <button onclick="window.print()" class="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-bold transition-all shadow-lg flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
        Imprimir / Salvar PDF
      </button>
    </div>

    <div class="p-8">
      ${config.draft ? `
        <div class="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 font-bold text-xs flex items-center gap-3">
          <span>⚠️ <strong>DOCUMENTO PRELIMINAR:</strong> Este relatório contém dados de escalas abertas/planejadas e está sujeito a alterações até homologação final.</span>
        </div>
      ` : ''}
      ${config.instituicaoCabecalhoUrl ? `
        <div class="flex justify-center mb-8 border-b border-zinc-200 pb-6">
          <img src="${config.instituicaoCabecalhoUrl}" alt="Cabeçalho da Instituição" class="max-h-24 object-contain" />
        </div>
      ` : ''}
      <div class="flex justify-between items-start border-b-2 border-zinc-900 pb-6 mb-8">
        <div>
          <h2 class="text-3xl font-black text-zinc-900 uppercase tracking-tighter">${config.title}</h2>
          <p class="text-zinc-500 font-medium">${config.subtitle || 'Módulo de Gestão de Escalas'}</p>
        </div>
        <div class="text-right">
          <p class="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Data de Emissão</p>
          <p class="text-lg font-bold text-zinc-900">${config.generationDate}</p>
        </div>
      </div>

      <div class="grid grid-cols-4 gap-6 mb-8 bg-zinc-50 p-6 rounded-2xl border border-zinc-100">
        ${Object.entries(config.filters).map(([key, value]) => `
          <div>
            <p class="text-[10px] font-black text-zinc-400 uppercase">${key}</p>
            <p class="font-bold text-zinc-800">${value || '---'}</p>
          </div>
        `).join('')}
      </div>

      ${content}

      <div class="mt-12 pt-6 border-t border-zinc-200 flex justify-between items-center text-[10px] text-zinc-400 uppercase font-bold tracking-widest">
        <span>SisEscala - Gestão Inteligente de Escalas</span>
      </div>
    </div>
  </div>
</body>
</html>
`;

export const templates = {
  consolidado: (data: any[]) => `
    <table class="w-full text-left text-xs">
      <thead>
        <tr class="bg-zinc-100 border-y-2 border-zinc-900">
          <th class="px-4 py-3 font-black uppercase">Servidor</th>
          <th class="px-4 py-3 font-black uppercase">Unidade/Setor</th>
          <th class="px-4 py-3 font-black uppercase text-center">Regular</th>
          <th class="px-4 py-3 font-black uppercase text-center">Extra</th>
          <th class="px-4 py-3 font-black uppercase text-center">Plantão</th>
          <th class="px-4 py-3 font-black uppercase text-center">Sobreaviso</th>
          <th class="px-4 py-3 font-black uppercase text-center">Total</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-zinc-200">
        ${data.map(item => `
          <tr>
            <td class="px-4 py-3">
              <div class="font-bold text-zinc-900 uppercase">${item.servidor}</div>
              <div class="text-[10px] text-zinc-500">Mat: ${item.matricula || '---'} • ${item.cargo}</div>
            </td>
            <td class="px-4 py-3">
              <div class="text-zinc-700 font-medium">${item.unidade}</div>
              <div class="text-[10px] text-zinc-500">${item.setor}</div>
            </td>
            <td class="px-4 py-3 text-center">${item.regular}h</td>
            <td class="px-4 py-3 text-center">${item.extra}h</td>
            <td class="px-4 py-3 text-center">${item.plantao}h</td>
            <td class="px-4 py-3 text-center">${item.sobreaviso}h</td>
            <td class="px-4 py-3 text-center font-bold">${item.totalGeral}h</td>
          </tr>
        `).join('')}
      </tbody>
      <tfoot>
        <tr class="bg-zinc-50 border-t-2 border-zinc-900 font-bold">
          <td colspan="2" class="px-4 py-3 uppercase">Totais do Período</td>
          <td class="px-4 py-3 text-center">${data.reduce((acc, c) => acc + c.regular, 0)}h</td>
          <td class="px-4 py-3 text-center">${data.reduce((acc, c) => acc + c.extra, 0)}h</td>
          <td class="px-4 py-3 text-center">${data.reduce((acc, c) => acc + c.plantao, 0)}h</td>
          <td class="px-4 py-3 text-center">${data.reduce((acc, c) => acc + c.sobreaviso, 0)}h</td>
          <td class="px-4 py-3 text-center font-black">${data.reduce((acc, c) => acc + c.totalGeral, 0)}h</td>
        </tr>
      </tfoot>
    </table>
  `,
  rh: (data: any[]) => `
    <table class="w-full text-left text-xs">
      <thead>
        <tr class="bg-zinc-100 border-y-2 border-zinc-900">
          <th class="px-4 py-3 font-black uppercase">Servidor</th>
          <th class="px-4 py-3 font-black uppercase">Unidade</th>
          <th class="px-4 py-3 font-black uppercase">Período</th>
          <th class="px-4 py-3 font-black uppercase text-right">Total CH</th>
          <th class="px-4 py-3 font-black uppercase text-right">Sobreavisos</th>
        </tr>
      </thead>
      <tbody>
        ${data.map(item => `
          <tr>
            <td class="px-4 py-3 font-bold uppercase">${item.servidor}</td>
            <td class="px-4 py-3">${item.unidade}</td>
            <td class="px-4 py-3 text-center">${item.periodo}</td>
            <td class="px-4 py-3 text-right font-bold">${item.chTotal}h</td>
            <td class="px-4 py-3 text-right font-bold">${item.sobCount}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `,
  frequencia: (data: any, config: any) => `
    <div class="space-y-6">
      <div class="grid grid-cols-2 gap-8 mb-8 border p-6 rounded-xl">
        <div>
          <p class="text-[10px] font-black text-zinc-400 uppercase">Servidor</p>
          <p class="font-bold uppercase text-sm">${data.servidor}</p>
          <p class="text-xs">Matrícula: ${data.matricula || '---'}</p>
        </div>
        <div>
          <p class="text-[10px] font-black text-zinc-400 uppercase">Unidade/Setor</p>
          <p class="font-bold uppercase text-sm">${data.unidade} / ${data.setor}</p>
        </div>
      </div>

      <table class="w-full text-[10px]">
        <thead>
          <tr class="bg-zinc-100 border-y-2 border-zinc-900">
            <th class="px-2 py-2 border-r w-8 text-center">Dia</th>
            <th class="px-2 py-2 border-r">Programação</th>
            <th class="px-2 py-2 border-r text-center w-12">Horas</th>
            <th class="px-2 py-2 border-r">Ocorrência</th>
            <th class="px-2 py-2 text-center w-24">Visto</th>
          </tr>
        </thead>
        <tbody>
          ${data.rows.map((row: any) => `
            <tr class="h-8 ${row.isWeekend ? 'bg-zinc-50' : ''}">
              <td class="px-2 py-1 border-r text-center font-bold">${row.day}</td>
              <td class="px-2 py-1 border-r">${row.programacao}</td>
              <td class="px-2 py-1 border-r text-center">${row.horas}h</td>
              <td class="px-2 py-1 border-r"></td>
              <td class="px-2 py-1 border-r"></td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="mt-20 grid grid-cols-2 gap-20">
        <div class="border-t border-zinc-400 text-center pt-2">
          <p class="text-[10px] font-bold uppercase">${data.servidor}</p>
          <p class="text-[8px] text-zinc-500 uppercase tracking-widest">Assinatura do Servidor</p>
        </div>
        <div class="border-t border-zinc-400 text-center pt-2">
          <p class="text-[10px] font-bold uppercase">Coordenação / Chefia Imediata</p>
          <p class="text-[8px] text-zinc-500 uppercase tracking-widest">Carimbo e Assinatura</p>
        </div>
      </div>
    </div>
  `,
  distribuicao: (data: any) => `
    <table class="w-full text-center border-collapse text-[8px]">
      <thead>
        <tr class="bg-zinc-100 border-y-2 border-zinc-900">
          <th class="px-2 py-2 text-left font-black uppercase w-20">Turno</th>
          ${Array.from({ length: data.daysInMonth }, (_, i) => `
            <th class="px-1 py-2 font-black border-x">${i + 1}</th>
          `).join('')}
        </tr>
      </thead>
      <tbody>
        ${data.sortedTurnos.map((turno: any) => `
          <tr class="border-b">
            <td class="px-2 py-2 text-left font-bold uppercase border-r">${turno}</td>
            ${Array.from({ length: data.daysInMonth }, (_, i) => {
              const count = data.coverageMap[i+1]?.[turno] || 0;
              let bg = count === 0 ? '' : count === 1 ? 'bg-blue-100' : 'bg-indigo-600 text-white';
              return `<td class="px-1 py-2 border-x ${bg}">${count || ''}</td>`;
            }).join('')}
          </tr>
        `).join('')}
      </tbody>
    </table>
  `
};
