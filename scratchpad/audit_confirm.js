const fs = require('fs')
const arquivos = [
  'src/app/(dashboard)/afastamentos/page.tsx',
  'src/app/(dashboard)/escalas/page.tsx',
  'src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx',
  'src/app/(dashboard)/folha-ponto/[id]/FolhaPontoEditor.tsx',
  'src/app/(dashboard)/jornadas/page.tsx',
  'src/app/(dashboard)/usuarios/UserManagementClient.tsx',
]
for (const f of arquivos) {
  const src = fs.readFileSync(f, 'utf8')
  const linhas = src.split(/\r?\n/)
  console.log(`\n=== ${f}`)
  linhas.forEach((l, i) => {
    if (!/onConfirm\s*:/.test(l)) return
    // Corpo do callback: da linha do onConfirm ate fechar o objeto do setConfirmModal.
    let prof = 0, fim = i, viu = false
    for (let j = i; j < Math.min(i + 80, linhas.length); j++) {
      for (const ch of linhas[j]) {
        if (ch === '{') { prof++; viu = true }
        else if (ch === '}') prof--
      }
      if (viu && prof <= 0) { fim = j; break }
    }
    const corpo = linhas.slice(i, fim + 1).join('\n')
    const fecha = /setConfirmModal\(null\)/.test(corpo)
    const titulo = (linhas.slice(Math.max(0, i - 6), i).find(x => /title\s*:/.test(x)) || '').trim().slice(0, 78)
    console.log(`  L${i + 1}  ${fecha ? 'fecha  ' : 'NAO FECHA'}  ${titulo}`)
  })
}
