// Correcao do Comparativo Historico (05/09/2026): barras proporcionais, rotulo de previsao
// e sobreaviso identificado como prontidao.
const fs = require('fs')
const P = 'src/app/(dashboard)/home/_components/HistoricoChart.tsx'
const CR = String.fromCharCode(13), NL = String.fromCharCode(10)
let s = fs.readFileSync(P, 'utf8')
const CRLF = s.indexOf(CR + NL) >= 0
if (CRLF) s = s.split(CR + NL).join(NL)
const antes = s.length
let n = 0
function sub(velho, novo, esperado = 1) {
  const c = s.split(velho).length - 1
  if (c !== esperado) {
    console.error('ABORTA: ' + c + ' ocorrencia(s), esperado ' + esperado + NL + '---' + NL + velho.slice(0, 200) + NL + '---')
    process.exit(1)
  }
  s = s.split(velho).join(novo)
  n++
}

// ---- 1. rotulo das categorias: sobreaviso e prontidao ----
sub(
  "    { key: 'sobreaviso' as const, label: 'Sobreaviso', color: 'bg-amber-500', darkColor: 'dark:bg-amber-400', textColor: 'text-amber-600 dark:text-amber-400' },",
  "    // ⚠️ Sobreaviso é PRONTIDÃO, não trabalho presencial: não entra na carga do servidor\n" +
  "    // (fn_carga_mensal_servidor e calculateTotals o excluem) e tem ciclo próprio em\n" +
  "    // logs_sobreaviso. Fica no gráfico porque é informação operacional, com rótulo que o\n" +
  "    // separa — nunca somado às horas trabalhadas.\n" +
  "    { key: 'sobreaviso' as const, label: 'Sobreaviso', nota: 'prontidão', color: 'bg-amber-500', darkColor: 'dark:bg-amber-400', textColor: 'text-amber-600 dark:text-amber-400' },"
)

// ---- 2. barras proporcionais ----
sub([
  '                    {categories.map(cat => {',
  '                      const val = month[cat.key]',
  '                      const pctHeight = maxValue > 0 ? (val / maxValue) * 100 : 0',
  '                      return (',
  '                        <div key={cat.key} className="flex-1 flex flex-col justify-end h-full">',
  '                          <div',
  '                            className={`w-full ${cat.color} ${cat.darkColor} rounded-t transition-all duration-700 ease-out group-hover:brightness-110 min-h-[3px] shadow-sm`}',
  '                            style={{ height: `${Math.max(pctHeight, val > 0 ? 4 : 2)}%` }}',
  '                            title={`${month.label.toUpperCase()} - ${cat.label}: ${val}h`}',
  '                          />',
  '                        </div>',
  '                      )',
  '                    })}'
].join(NL), [
  '                    {categories.map(cat => {',
  '                      const val = month[cat.key]',
  '                      // 🚨 A ALTURA TINHA PISO DE 4%, ENTÃO A BARRA NÃO ERA PROPORCIONAL.',
  '                      //   Em JUL/2026, Sobreaviso (156h) e Regular (13.218h) — 85x maior —',
  '                      //   saíam praticamente da mesma altura, e é assim que se lê o gráfico',
  '                      //   antes de ler os cartões. Num painel de decisão, barra que não',
  '                      //   respeita a escala é pior que barra nenhuma.',
  '                      //   O piso agora é de 2px (via min-h), só para um valor pequeno mas',
  '                      //   existente não desaparecer por completo — não infla o percentual.',
  '                      const pctHeight = maxValue > 0 ? (val / maxValue) * 100 : 0',
  '                      return (',
  '                        <div key={cat.key} className="flex-1 flex flex-col justify-end h-full">',
  '                          <div',
  '                            className={`w-full ${cat.color} ${cat.darkColor} rounded-t transition-all duration-700 ease-out group-hover:brightness-110 shadow-sm ${val > 0 ? \'min-h-[2px]\' : \'\'}`}',
  '                            style={{ height: `${pctHeight}%` }}',
  '                            title={`${month.label.toUpperCase()} — ${cat.label}: ${val.toLocaleString(\'pt-BR\')}h`}',
  '                          />',
  '                        </div>',
  '                      )',
  '                    })}'
].join(NL))

// ---- 3. subtitulo: dizer que e escala prevista, nao realizada ----
sub([
  '          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">',
  '            Clique nos meses para alternar os dados exibidos nos cartões',
  '          </p>'
].join(NL), [
  '          {/* ⚠️ ISTO É ESCALA LANÇADA (previsão), NÃO HORA TRABALHADA. Sem dizer isso, a',
  '              variação percentual entre meses é lida como aumento de trabalho quando na maior',
  '              parte é implantação: o HMI saiu de 6 escalados em 08/2026 para 390 em 09/2026, e',
  '              sozinho respondeu por 89% das horas de plantão do mês. Hora realizada é a folha. */}',
  '          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">',
  '            Horas de escala <span className="font-semibold">prevista</span> — não é hora trabalhada. Clique nos meses para alternar os cartões.',
  '          </p>'
].join(NL))

// ---- 4. aviso de comparabilidade ao lado de "Comparado com <mes>" ----
sub([
  '          <span className="text-[10px] text-zinc-400">',
  '            Comparado com {previousMonth.label.toUpperCase()}',
  '          </span>'
].join(NL), [
  '          <span className="text-[10px] text-zinc-400" title="A variação inclui setores que passaram a lançar escala no sistema — não é só aumento de jornada.">',
  '            Comparado com {previousMonth.label.toUpperCase()}',
  '          </span>'
].join(NL))

// ---- 5. cartao: exibir a nota da categoria e separar milhar ----
sub([
  '                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 truncate">',
  '                  {cat.label}',
  '                </p>',
  '                <p className="text-base font-black text-zinc-900 dark:text-white">',
  '                  {val}h',
  '                </p>'
].join(NL), [
  '                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 truncate">',
  '                  {cat.label}{cat.nota ? <span className="normal-case font-semibold"> ({cat.nota})</span> : null}',
  '                </p>',
  '                <p className="text-base font-black text-zinc-900 dark:text-white">',
  "                  {val.toLocaleString('pt-BR')}h",
  '                </p>'
].join(NL))

fs.writeFileSync(P, CRLF ? s.split(NL).join(CR + NL) : s)
console.log(P + ': ' + n + ' substituicoes, ' + antes + ' -> ' + s.length + ' bytes')
