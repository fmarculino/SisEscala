/**
 * Feriado deixa de ser preenchido pelo Aplicar Template (issue #5).
 *
 * Mexe em dois arquivos: a funcao pura que decide quais dias sao feriado
 * (src/utils/scaleTemplates.ts) e o handler da grade, que a alimenta e relata.
 */
const fs = require('fs')

/**
 * `marcaDeAplicado` torna o gerador IDEMPOTENTE.
 *
 * Sem ela, a segunda execucao (que acontece ao corrigir uma ancora e rodar de novo) insere o
 * bloco outra vez — e foi exatamente o que aconteceu ao escrever este script: `diasDeFeriado`
 * ficou definida DUAS vezes em scaleTemplates.ts, e o `tsc` so reclamaria do redeclare. Um
 * gerador que so conta ocorrencias da ancora nao percebe que ja rodou.
 */
function editar(path, trocas, invariantes, marcaDeAplicado) {
  let src = fs.readFileSync(path, 'utf8')
  const EOL = src.includes('\r\n') ? '\r\n' : '\n'
  const L = (...linhas) => linhas.join(EOL)

  if (marcaDeAplicado && src.includes(marcaDeAplicado)) {
    console.log('JA APLICADO em ' + path + ' — nada a fazer')
    return
  }

  for (const [de, para, nome] of trocas) {
    const alvo = Array.isArray(de) ? L(...de) : de
    const novo = Array.isArray(para) ? L(...para) : para
    const n = src.split(alvo).length - 1
    if (n !== 1) {
      console.error('ABORTADO em ' + path + ': ' + nome + ' — esperava 1 ocorrencia, achei ' + n)
      process.exit(1)
    }
    src = src.split(alvo).join(novo)
  }

  for (const [nome, marca] of invariantes) {
    if (!src.includes(marca)) {
      console.error('ABORTADO em ' + path + ': invariante perdida — ' + nome)
      process.exit(1)
    }
  }

  fs.writeFileSync(path, src)
  console.log('OK ' + path + ' (EOL=' + (EOL === '\r\n' ? 'CRLF' : 'LF') + ')')
}

// ------------------------------------------------------------------ 1. o modulo puro

editar(
  'src/utils/scaleTemplates.ts',
  [
    [
      [
        "/**",
        " * Helper: conta o total de dias de trabalho gerados pelo template.",
        " */"
      ],
      [
        "/**",
        " * Os dias do mes que caem em feriado.",
        " *",
        " * ⚠️ Compara STRING `YYYY-MM-DD`, nunca `new Date(...)`: o processo roda em UTC e",
        " * `new Date('2026-09-07')` e meia-noite UTC, que em America/Sao_Paulo e dia 6 (armadilha 12).",
        " * `feriados[].data` ja vem do banco nessa forma, e o resto da grade a compara assim.",
        " *",
        " * ⚠️ Feriado MOVEL de outro ano nao entra por acidente: o ano e o mes sao montados no",
        " * prefixo, entao so casa o feriado daquela competencia.",
        " */",
        "export function diasDeFeriado(",
        "  feriados: Array<{ data?: string | null }> | null | undefined,",
        "  mes: number,",
        "  ano: number,",
        "  daysInMonth: number",
        "): Set<number> {",
        "  const dias = new Set<number>()",
        "  if (!feriados || feriados.length === 0) return dias",
        "",
        "  const prefixo = `${ano}-${String(mes).padStart(2, '0')}-`",
        "  for (const f of feriados) {",
        "    if (!f?.data || !f.data.startsWith(prefixo)) continue",
        "    const dia = parseInt(f.data.slice(prefixo.length, prefixo.length + 2), 10)",
        "    if (Number.isFinite(dia) && dia >= 1 && dia <= daysInMonth) dias.add(dia)",
        "  }",
        "  return dias",
        "}",
        "",
        "/**",
        " * Helper: conta o total de dias de trabalho gerados pelo template.",
        " */"
      ],
      'funcao diasDeFeriado'
    ]
  ],
  [
    ['generateTemplate preservada', 'export function generateTemplate('],
    ['5x2 continua pulando fim de semana', 'const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5'],
    ['protectedDays continua sendo respeitado por todos', 'protectedDays.has(day)']
  ],
  'export function diasDeFeriado'
)

// ------------------------------------------------------------------ 2. a grade

const GRADE = 'src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx'

editar(
  GRADE,
  [
    [
      "import { generateTemplate, TEMPLATE_OPTIONS, type TemplateType, countWorkDays } from '@/utils/scaleTemplates'",
      "import { generateTemplate, TEMPLATE_OPTIONS, type TemplateType, countWorkDays, diasDeFeriado } from '@/utils/scaleTemplates'",
      'import de diasDeFeriado'
    ],
    [
      [
        "    startWorking: boolean",
        "    validatePastDays?: boolean",
        "  } | null>(null)"
      ],
      [
        "    startWorking: boolean",
        "    validatePastDays?: boolean",
        "    /**",
        "     * Feriado nao e preenchido por padrao (issue #5).",
        "     *",
        "     * ⚠️ O motivo e a ASSIMETRIA DO ERRO, nao o calendario: deixar o dia vazio custa uma",
        "     * celula digitada a mao e fica VISIVEL na grade; preencher um feriado que a pessoa nao",
        "     * trabalhou, junto com 'validar dias passados', grava presenca que o coordenador nao",
        "     * consegue mais apagar (a celula com ponto e protegida). Quem trabalha no feriado",
        "     * desmarca a caixa ou lanca o dia a mao.",
        "     */",
        "    pularFeriados?: boolean",
        "  } | null>(null)"
      ],
      'campo pularFeriados no estado'
    ],
    [
      [
        "        startDay: 1,",
        "        startWorking: true,",
        "        validatePastDays: false",
        "      })"
      ],
      [
        "        startDay: 1,",
        "        startWorking: true,",
        "        validatePastDays: false,",
        "        pularFeriados: true",
        "      })"
      ],
      'default marcado ao abrir o modal'
    ],
    [
      [
        "                  const conflictDays = new Set<number>(conflitosExternos.map(c => c.dia))",
        "",
        "                  // generateTemplate não escreve nos dias que recebe como protegidos —",
        "                  // presença confirmada, afastamento e sobreposição entram pelo mesmo canal.",
        "                  const skipDays = new Set<number>([...protectedDays, ...leaveDays, ...conflictDays])"
      ],
      [
        "                  const conflictDays = new Set<number>(conflitosExternos.map(c => c.dia))",
        "",
        "                  // Feriado, quando a caixa está marcada (o padrão).",
        "                  //",
        "                  // ⚠️ Vale para TODOS os modelos, inclusive os cíclicos (12×36, 12×48, 6×1), que",
        "                  // caem em qualquer dia da semana de propósito. O plantonista que trabalha no",
        "                  // feriado desmarca a caixa — e o relato diz quais dias ficaram de fora, então a",
        "                  // decisão não acontece em silêncio.",
        "                  const holidayDays = templateModal.pularFeriados !== false",
        "                    ? new Set<number>([...diasDeFeriado(feriados, mes, ano, daysInMonth)]",
        "                        .filter(d => d >= templateModal.startDay))",
        "                    : new Set<number>()",
        "",
        "                  // generateTemplate não escreve nos dias que recebe como protegidos —",
        "                  // presença confirmada, afastamento, sobreposição e feriado entram pelo mesmo canal.",
        "                  const skipDays = new Set<number>([...protectedDays, ...leaveDays, ...conflictDays, ...holidayDays])"
      ],
      'holidayDays entrando em skipDays'
    ],
    [
      [
        "                  for (let d = templateModal.startDay; d <= daysInMonth; d++) {",
        "                    if (templateResult[d]) {",
        "                      updatedRegular[d] = templateResult[d]",
        "                    } else if (!protectedDays.has(d) && !conflictDays.has(d)) {",
        "                      delete updatedRegular[d]",
        "                    }",
        "                  }"
      ],
      [
        "                  for (let d = templateModal.startDay; d <= daysInMonth; d++) {",
        "                    if (templateResult[d]) {",
        "                      updatedRegular[d] = templateResult[d]",
        "                    } else if (!protectedDays.has(d) && !conflictDays.has(d)) {",
        "                      delete updatedRegular[d]",
        "                    }",
        "                  }"
      ],
      'laco de mesclagem (sanidade: feriado apagado como dia de folga, que e o certo)'
    ],
    [
      [
        "                    dias_afastamento: leaveDays.size,",
        "                    dias_conflito_setor: conflictDays.size",
        "                  })"
      ],
      [
        "                    dias_afastamento: leaveDays.size,",
        "                    dias_conflito_setor: conflictDays.size,",
        "                    dias_feriado: holidayDays.size",
        "                  })"
      ],
      'log com dias_feriado'
    ],
    [
      [
        "                  const diasAfastado = [...leaveDays].sort((a, b) => a - b)",
        "                  const diasConflito = [...conflictDays].sort((a, b) => a - b)"
      ],
      [
        "                  const diasAfastado = [...leaveDays].sort((a, b) => a - b)",
        "                  const diasConflito = [...conflictDays].sort((a, b) => a - b)",
        "                  // Relatar o que NAO foi preenchido e por que (armadilha 22): sem isto, o",
        "                  // coordenador descobriria o feriado vazio so ao conferir a grade dia a dia.",
        "                  const diasFeriado = [...holidayDays].sort((a, b) => a - b)"
      ],
      'lista de dias de feriado para o relato'
    ],
    [
      "${diasConflito.length > 0 ? `, ${diasConflito.length} dias não preenchidos porque o servidor já está escalado em outro setor no mesmo horário (dias ${diasConflito.join(', ')})` : ''}. Lembre-se de salvar a escala.`,",
      "${diasConflito.length > 0 ? `, ${diasConflito.length} dias não preenchidos porque o servidor já está escalado em outro setor no mesmo horário (dias ${diasConflito.join(', ')})` : ''}${diasFeriado.length > 0 ? `, ${diasFeriado.length} ${diasFeriado.length === 1 ? 'dia não preenchido por ser feriado' : 'dias não preenchidos por serem feriado'} (${diasFeriado.length === 1 ? 'dia' : 'dias'} ${diasFeriado.join(', ')}) — se houve trabalho no feriado, lance o dia à mão` : ''}. Lembre-se de salvar a escala.`,",
      'relato mencionando os feriados'
    ],
    [
      [
        "              <div className=\"bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 p-3 rounded-lg\">",
        "                <p className=\"text-[10px] text-purple-700 dark:text-purple-400\">",
        "                  ⚠️ Dias com presença já confirmada <strong>não serão sobrescritos</strong>, e dias de <strong>afastamento</strong> não serão preenchidos. O template preenche apenas a linha <strong>Regular</strong>.",
        "                </p>",
        "              </div>"
      ],
      [
        "              {/* Feriado nao preenchido: a caixa nasce MARCADA, e quem trabalha no feriado",
        "                  desmarca. Ver o comentario do campo `pularFeriados` no estado do modal. */}",
        "              <div className=\"flex items-start space-x-2.5 py-1 bg-red-50/50 dark:bg-red-950/10 p-2.5 rounded-lg border border-red-100 dark:border-red-900/30\">",
        "                <input",
        "                  type=\"checkbox\"",
        "                  id=\"pularFeriados\"",
        "                  checked={templateModal.pularFeriados !== false}",
        "                  onChange={(e) => setTemplateModal(prev => prev ? { ...prev, pularFeriados: e.target.checked } : null)}",
        "                  className=\"mt-0.5 h-4 w-4 rounded border-zinc-350 text-red-600 focus:ring-red-500 cursor-pointer\"",
        "                />",
        "                <label htmlFor=\"pularFeriados\" className=\"text-xs font-semibold text-zinc-700 dark:text-zinc-300 cursor-pointer select-none\">",
        "                  Não preencher feriados",
        "                  <span className=\"block text-[10px] font-normal text-zinc-500 dark:text-zinc-400\">",
        "                    {feriadosDoMesNoTemplate.length > 0",
        "                      ? `Neste mês: ${feriadosDoMesNoTemplate.map(f => `dia ${f.dia} (${f.descricao})`).join(', ')}. Desmarque se o servidor trabalha em feriado.`",
        "                      : 'Não há feriado cadastrado nesta competência.'}",
        "                  </span>",
        "                </label>",
        "              </div>",
        "",
        "              <div className=\"bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 p-3 rounded-lg\">",
        "                <p className=\"text-[10px] text-purple-700 dark:text-purple-400\">",
        "                  ⚠️ Dias com presença já confirmada <strong>não serão sobrescritos</strong>, e dias de <strong>afastamento</strong> não serão preenchidos. O template preenche apenas a linha <strong>Regular</strong>.",
        "                </p>",
        "              </div>"
      ],
      'caixa de nao preencher feriados no modal'
    ]
  ],
  [
    ['skipDays continua alimentando generateTemplate', '                    skipDays'],
    ['validacao de dias passados preservada', 'if (templateModal.validatePastDays) {'],
    ['teto mensal preservado', 'if (cargaSimulada.excede) {'],
    ['conflito entre setores preservado', 'const conflictDays = new Set<number>(conflitosExternos.map(c => c.dia))']
  ],
  'pularFeriados?: boolean'
)
