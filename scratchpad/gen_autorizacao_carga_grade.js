/**
 * Aplica em ScaleGrid.tsx a troca de "só admin autoriza" pela fonte única de
 * `src/utils/autorizacaoCarga.ts` + o caminho de SOLICITAÇÃO ao RH (31/08/2026).
 *
 * ⚠️ Gerador em vez de edição à mão porque a condição `role === 'super_admin' || role ===
 * 'admin'` aparece em QUATRO pontos independentes do arquivo (célula, salvar, escudo da linha,
 * Aplicar Template) e as quatro precisam mudar pelo mesmo critério — é o mesmo motivo de
 * `gen_ancora.js` e companhia. Cada substituição exige contagem exata e o script ABORTA na
 * divergência: aplicar três de quatro deixaria um caminho oferecendo "solicite a um
 * Administrador" sem pedido nenhum por trás, que é exatamente o defeito sendo corrigido.
 *
 * Uso: node scratchpad/gen_autorizacao_carga_grade.js
 */
const fs = require('fs')
const path = require('path')

const ALVO = path.join(
  __dirname, '..', 'src', 'app', '(dashboard)', 'escalas', 'unidade', '[unidadeId]', 'ScaleGrid.tsx'
)

let src = fs.readFileSync(ALVO, 'utf8')
const CRLF = src.includes('\r\n')
src = src.replace(/\r\n/g, '\n')

const trocas = []
function troca(nome, de, para, esperado = 1) {
  const n = src.split(de).length - 1
  if (n !== esperado) {
    throw new Error(`[${nome}] esperava ${esperado} ocorrencia(s), achei ${n}.`)
  }
  src = src.split(de).join(para)
  trocas.push(`${nome}: ${n}`)
}

// ---------------------------------------------------------------------------
// 1. Imports
// ---------------------------------------------------------------------------
troca('import-utils',
`import { buildSectorPathMap, formatSectorsHierarchy } from '@/utils/sectors'`,
`import {
  podeAutorizarCarga,
  mensagemTetoExcedido,
  instrucaoSalvarBloqueado,
  type PedidoPendente
} from '@/utils/autorizacaoCarga'
import { buildSectorPathMap, formatSectorsHierarchy } from '@/utils/sectors'`)

troca('import-modal',
`import { AutorizacaoExcecaoModal } from '@/components/escalas/AutorizacaoExcecaoModal'`,
`import { AutorizacaoExcecaoModal } from '@/components/escalas/AutorizacaoExcecaoModal'
import { SolicitarExcecaoModal } from '@/components/escalas/SolicitarExcecaoModal'`)

// ---------------------------------------------------------------------------
// 2. Estado + carga dos pedidos pendentes
// ---------------------------------------------------------------------------
troca('estado',
`  const [excecoesEscala, setExcecoesEscala] = useState<any[]>([])`,
`  const [excecoesEscala, setExcecoesEscala] = useState<any[]>([])
  /**
   * Pedidos de Autorização Extraordinária EM ABERTO na competência, por servidor.
   *
   * ⚠️ Sem isto o coordenador que já pediu recebe de novo o convite para pedir, e a RPC recusa
   * com "já existe pedido pendente" — a tela mandaria fazer algo que ela mesma vai negar. É a
   * mesma regra do texto de teto: não oferecer o que não vai acontecer.
   */
  const [pedidosPendentes, setPedidosPendentes] = useState<Record<string, PedidoPendente>>({})
  const [solicitacaoModalState, setSolicitacaoModalState] = useState<{
    isOpen: boolean
    servidorId: string
    servidorNome: string
    horasAtuais: number
    sobreavisosAtuais: number
  } | null>(null)`)

troca('fetch-pendentes',
`  useEffect(() => {
    fetchServidoresEventos()
    fetchJornadasTemporarias()
    fetchLogsTentativas()
    fetchExcecoesEscala()`,
`  /**
   * ⚠️ Vem de \`fn_solicitacoes_excecao_carga\` (SECURITY DEFINER), não de um SELECT na tabela: a
   * listagem precisa do NOME de quem pediu, e a RLS de \`profiles\` só libera a tabela inteira
   * para super_admin — um coordenador consultando o autor receberia zero linhas.
   */
  const fetchPedidosPendentes = useCallback(async () => {
    if (!mes || !ano) return
    const { data, error } = await supabase.rpc('fn_solicitacoes_excecao_carga', {
      p_status: 'pendente', p_mes: mes, p_ano: ano
    })
    if (error || !data) return
    const porServidor: Record<string, PedidoPendente> = {}
    for (const s of data) porServidor[s.servidor_id] = s
    setPedidosPendentes(porServidor)
  }, [supabase, mes, ano])

  useEffect(() => {
    fetchServidoresEventos()
    fetchJornadasTemporarias()
    fetchLogsTentativas()
    fetchExcecoesEscala()
    fetchPedidosPendentes()`)

// ---------------------------------------------------------------------------
// 3. Célula (handleCellChange)
// ---------------------------------------------------------------------------
troca('celula',
`        const isAdmin = userProfile?.role === 'super_admin' || userProfile?.role === 'admin'
        // O texto lista as outras escalas: sem dizer ONDE estão as horas, quem lança não tem
        // como decidir nada — o número dele continua parecendo certo.
        const detalhe = descreverExcesso(avaliacao, servidorNome)

        if (isAdmin) {
          setConfirmModal({
            isOpen: true,
            title: '⚠️ Teto Mensal Excedido (Bloqueio de Escala)',
            message: \`\${detalhe}\\n\\nComo Administrador, você pode autorizar uma Exceção Extraordinária para este servidor neste mês. Deseja abrir a tela de autorização?\`,
            type: 'warning',
            onConfirm: () => {
              setAutorizacaoModalState({
                isOpen: true,
                servidorId,
                servidorNome,
                horasAtuais: totals.totalPlanejado,
                sobreavisosAtuais: totals.p_soQtd
              })
            }
          })
        } else {
          setAlertModal({
            isOpen: true,
            title: '⚠️ Teto Mensal Excedido',
            message: \`\${detalhe}\\n\\nSolicite a um Administrador a concessão de uma Autorização Extraordinária.\`,
            type: 'warning'
          })
        }
        return`,
`        // O texto lista as outras escalas: sem dizer ONDE estão as horas, quem lança não tem
        // como decidir nada — o número dele continua parecendo certo.
        const detalhe = descreverExcesso(avaliacao, servidorNome)
        // Quem decide de fato é o banco (\`fn_pode_autorizar_excecao_carga\`, avaliada dentro da
        // policy de escrita); aqui se decide só O QUE OFERECER. Ver src/utils/autorizacaoCarga.ts.
        const aviso = mensagemTetoExcedido(detalhe, userProfile?.role, pedidosPendentes[servidorId])

        if (aviso.acao === 'autorizar' && !pedidosPendentes[servidorId]) {
          setConfirmModal({
            isOpen: true,
            title: aviso.titulo,
            message: aviso.mensagem,
            type: 'warning',
            onConfirm: () => {
              setAutorizacaoModalState({
                isOpen: true,
                servidorId,
                servidorNome,
                horasAtuais: totals.totalPlanejado,
                sobreavisosAtuais: totals.p_soQtd
              })
            }
          })
        } else if (aviso.acao === 'solicitar' && !pedidosPendentes[servidorId]) {
          setConfirmModal({
            isOpen: true,
            title: aviso.titulo,
            message: aviso.mensagem,
            type: 'warning',
            onConfirm: () => {
              setSolicitacaoModalState({
                isOpen: true,
                servidorId,
                servidorNome,
                horasAtuais: totals.totalPlanejado,
                sobreavisosAtuais: totals.p_soQtd
              })
            }
          })
        } else {
          setAlertModal({
            isOpen: true,
            title: aviso.titulo,
            message: aviso.mensagem,
            type: 'warning'
          })
        }
        return`)

// ---------------------------------------------------------------------------
// 4. Salvar Previsão (lote)
// ---------------------------------------------------------------------------
troca('salvar',
`        const isAdmin = userProfile?.role === 'super_admin' || userProfile?.role === 'admin'
        setAlertModal({
          isOpen: true,
          title: '⚠️ Teto Mensal Excedido',
          message: \`Não é possível salvar: \${estouros.length === 1 ? 'um servidor ultrapassa' : \`\${estouros.length} servidores ultrapassam\`} o teto do mês somando TODAS as escalas da competência.\\n\\n\${estouros.slice(0, 8).join('\\n')}\${estouros.length > 8 ? \`\\n...e mais \${estouros.length - 8}.\` : ''}\\n\\n\${
            isAdmin
              ? 'Reduza a escala ou clique no escudo vermelho ao lado do nome para autorizar excepcionalmente.'
              : 'Reduza a escala ou solicite a um Administrador uma Autorização Extraordinária.'
          }\`,
          type: 'warning'
        })`,
`        setAlertModal({
          isOpen: true,
          title: '⚠️ Teto Mensal Excedido',
          message: \`Não é possível salvar: \${estouros.length === 1 ? 'um servidor ultrapassa' : \`\${estouros.length} servidores ultrapassam\`} o teto do mês somando TODAS as escalas da competência.\\n\\n\${estouros.slice(0, 8).join('\\n')}\${estouros.length > 8 ? \`\\n...e mais \${estouros.length - 8}.\` : ''}\\n\\n\${instrucaoSalvarBloqueado(userProfile?.role)}\`,
          type: 'warning'
        })`)

// ---------------------------------------------------------------------------
// 5. Escudo na linha do servidor
// ---------------------------------------------------------------------------
troca('escudo',
`                                const excecao = excecoesEscala.find(e => e.servidor_id === em.servidor_id)
                                const isAdmin = userProfile?.role === 'super_admin' || userProfile?.role === 'admin'`,
`                                const excecao = excecoesEscala.find(e => e.servidor_id === em.servidor_id)
                                const podeAutorizar = podeAutorizarCarga(userProfile?.role)
                                const pedido = pedidosPendentes[em.servidor_id]`)

troca('escudo-excecao-click',
`                                      onClick={() => {
                                        if (isAdmin) {
                                          setAutorizacaoModalState({
                                            isOpen: true,
                                            servidorId: em.servidor_id,
                                            servidorNome: em.servidores?.nome || 'Servidor',
                                            horasAtuais: totals.totalPlanejado,
                                            sobreavisosAtuais: totals.p_soQtd
                                          })
                                        }
                                      }}`,
`                                      onClick={() => {
                                        if (podeAutorizar) {
                                          setAutorizacaoModalState({
                                            isOpen: true,
                                            servidorId: em.servidor_id,
                                            servidorNome: em.servidores?.nome || 'Servidor',
                                            horasAtuais: totals.totalPlanejado,
                                            sobreavisosAtuais: totals.p_soQtd
                                          })
                                        }
                                      }}`)

troca('escudo-excede',
`                                      onClick={() => {
                                        if (isAdmin) {
                                          setAutorizacaoModalState({
                                            isOpen: true,
                                            servidorId: em.servidor_id,
                                            servidorNome: em.servidores?.nome || 'Servidor',
                                            horasAtuais: totals.totalPlanejado,
                                            sobreavisosAtuais: totals.p_soQtd
                                          })
                                        } else {
                                          setAlertModal({
                                            isOpen: true,
                                            title: '⚠️ Teto Mensal Excedido',
                                            message: \`\${resumo}\\n\\nSolicite a um Administrador a concessão de uma Autorização Extraordinária.\`,
                                            type: 'warning'
                                          })
                                        }
                                      }}
                                      className="p-1 text-red-700 dark:text-red-300 bg-red-100/80 dark:bg-red-950/70 hover:bg-red-200 dark:hover:bg-red-900 rounded border border-red-300 dark:border-red-800 transition-colors shadow-xs"
                                      title={\`\${resumo}\\n\\n\${isAdmin ? 'Clique para autorizar excepcionalmente.' : 'Clique para ver o detalhe.'}\`}
                                    >
                                      <ShieldAlert className="h-3.5 w-3.5 fill-red-500/20" />
                                    </button>`,
`                                      onClick={() => {
                                        const aviso = mensagemTetoExcedido(resumo, userProfile?.role, pedido)
                                        if (aviso.acao === 'autorizar' && !pedido) {
                                          setAutorizacaoModalState({
                                            isOpen: true,
                                            servidorId: em.servidor_id,
                                            servidorNome: em.servidores?.nome || 'Servidor',
                                            horasAtuais: totals.totalPlanejado,
                                            sobreavisosAtuais: totals.p_soQtd
                                          })
                                        } else if (aviso.acao === 'solicitar' && !pedido) {
                                          setSolicitacaoModalState({
                                            isOpen: true,
                                            servidorId: em.servidor_id,
                                            servidorNome: em.servidores?.nome || 'Servidor',
                                            horasAtuais: totals.totalPlanejado,
                                            sobreavisosAtuais: totals.p_soQtd
                                          })
                                        } else {
                                          setAlertModal({
                                            isOpen: true,
                                            title: aviso.titulo,
                                            message: aviso.mensagem,
                                            type: 'warning'
                                          })
                                        }
                                      }}
                                      className={\`p-1 rounded border transition-colors shadow-xs \${
                                        pedido
                                          ? 'text-blue-700 dark:text-blue-300 bg-blue-100/80 dark:bg-blue-950/70 hover:bg-blue-200 dark:hover:bg-blue-900 border-blue-300 dark:border-blue-800'
                                          : 'text-red-700 dark:text-red-300 bg-red-100/80 dark:bg-red-950/70 hover:bg-red-200 dark:hover:bg-red-900 border-red-300 dark:border-red-800'
                                      }\`}
                                      title={\`\${resumo}\\n\\n\${
                                        pedido
                                          ? \`Pedido de autorização em análise\${pedido.solicitado_por_nome ? \` (aberto por \${pedido.solicitado_por_nome})\` : ''}.\`
                                          : podeAutorizar
                                            ? 'Clique para autorizar excepcionalmente.'
                                            : 'Clique para solicitar autorização ao RH.'
                                      }\`}
                                    >
                                      {/* Azul = pedido em análise; vermelho = ninguém pediu nada
                                          ainda. A cor precisa distinguir "travado e parado" de
                                          "travado e em andamento" — sem isso, quem já pediu vê o
                                          mesmo alerta do primeiro dia e pede de novo. */}
                                      <ShieldAlert className="h-3.5 w-3.5 fill-red-500/20" />
                                    </button>`)

// ---------------------------------------------------------------------------
// 6. Aplicar Template
// ---------------------------------------------------------------------------
troca('template',
`                    const isAdmin = userProfile?.role === 'super_admin' || userProfile?.role === 'admin'

                    if (isAdmin) {
                      setConfirmModal({
                        isOpen: true,
                        title: '⚠️ Teto Mensal Excedido (Template não aplicado)',
                        message: \`\${detalhe}\\n\\nO template NÃO foi aplicado. Como Administrador, você pode autorizar uma Exceção Extraordinária e aplicá-lo de novo. Deseja abrir a tela de autorização?\`,
                        type: 'warning',
                        onConfirm: () => {
                          setTemplateModal(null)
                          setAutorizacaoModalState({
                            isOpen: true,
                            servidorId: sId,
                            servidorNome: nome,
                            horasAtuais: calculateTotals(sId).totalPlanejado,
                            sobreavisosAtuais: calculateTotals(sId).p_soQtd
                          })
                        }
                      })
                    } else {
                      setAlertModal({
                        isOpen: true,
                        title: '⚠️ Teto Mensal Excedido (Template não aplicado)',
                        message: \`\${detalhe}\\n\\nO template NÃO foi aplicado. Reduza o período ou solicite a um Administrador uma Autorização Extraordinária.\`,
                        type: 'warning'
                      })
                    }
                    return`,
`                    const pedidoAberto = pedidosPendentes[sId]
                    const aviso = mensagemTetoExcedido(detalhe, userProfile?.role, pedidoAberto)
                    const semTemplate = 'O template NÃO foi aplicado.'

                    if (aviso.acao === 'autorizar' && !pedidoAberto) {
                      setConfirmModal({
                        isOpen: true,
                        title: '⚠️ Teto Mensal Excedido (Template não aplicado)',
                        message: \`\${detalhe}\\n\\n\${semTemplate} Você pode conceder uma Autorização Extraordinária e aplicá-lo de novo. Deseja abrir a tela de autorização?\`,
                        type: 'warning',
                        onConfirm: () => {
                          setTemplateModal(null)
                          setAutorizacaoModalState({
                            isOpen: true,
                            servidorId: sId,
                            servidorNome: nome,
                            horasAtuais: calculateTotals(sId).totalPlanejado,
                            sobreavisosAtuais: calculateTotals(sId).p_soQtd
                          })
                        }
                      })
                    } else if (aviso.acao === 'solicitar' && !pedidoAberto) {
                      setConfirmModal({
                        isOpen: true,
                        title: '⚠️ Teto Mensal Excedido (Template não aplicado)',
                        message: \`\${detalhe}\\n\\n\${semTemplate} Você pode solicitar ao RH uma Autorização Extraordinária. Deseja abrir o pedido agora?\`,
                        type: 'warning',
                        onConfirm: () => {
                          setTemplateModal(null)
                          setSolicitacaoModalState({
                            isOpen: true,
                            servidorId: sId,
                            servidorNome: nome,
                            horasAtuais: calculateTotals(sId).totalPlanejado,
                            sobreavisosAtuais: calculateTotals(sId).p_soQtd
                          })
                        }
                      })
                    } else {
                      setAlertModal({
                        isOpen: true,
                        title: '⚠️ Teto Mensal Excedido (Template não aplicado)',
                        message: \`\${detalhe}\\n\\n\${semTemplate} \${aviso.mensagem.split('\\n\\n').slice(1).join('\\n\\n')}\`,
                        type: 'warning'
                      })
                    }
                    return`)

// ---------------------------------------------------------------------------
// 7. Render do modal de solicitação, ao lado do de autorização
// ---------------------------------------------------------------------------
troca('render-modal',
`      {autorizacaoModalState?.isOpen && (
        <AutorizacaoExcecaoModal`,
`      {solicitacaoModalState?.isOpen && (
        <SolicitarExcecaoModal
          isOpen={solicitacaoModalState.isOpen}
          onClose={() => setSolicitacaoModalState(null)}
          onEnviado={(mensagem) => {
            fetchPedidosPendentes()
            setAlertModal({ isOpen: true, title: 'Pedido enviado', message: mensagem, type: 'success' })
          }}
          servidorId={solicitacaoModalState.servidorId}
          servidorNome={solicitacaoModalState.servidorNome}
          unidadeId={unidadeId}
          setorId={setorId}
          mes={mes}
          ano={ano}
          horasAtuais={solicitacaoModalState.horasAtuais}
          sobreavisosAtuais={solicitacaoModalState.sobreavisosAtuais}
          cargasOutras={(cargaMensal[solicitacaoModalState.servidorId] || []).filter(
            c => c.escala_mensal_id !== escalaMensal.find(em => em.servidor_id === solicitacaoModalState.servidorId)?.id
          )}
          tetoHoras={Number(tetoCarga[solicitacaoModalState.servidorId]?.teto_horas ?? configs['max_horas_escala_servidor']) || 300}
          tetoSobreavisos={Number(tetoCarga[solicitacaoModalState.servidorId]?.teto_sobreavisos ?? configs['max_sobreavisos_escala_servidor']) || 10}
        />
      )}

      {autorizacaoModalState?.isOpen && (
        <AutorizacaoExcecaoModal`)

// ---------------------------------------------------------------------------
// Conferência estrutural do arquivo inteiro
// ---------------------------------------------------------------------------
// Nenhuma decisão de CARGA pode continuar decidindo papel inline. O que sobrevive é
// `isAdminRole` (linha ~4275), que é outra coisa — valida presença e ignora a trava de previsão
// —, e ele é escrito na ordem inversa (`'admin' || 'super_admin'`), então não casa com este
// padrão. Se casar, é porque um bloco de teto ficou para trás.
const sobrou = src.match(/role === 'super_admin' \|\| userProfile\?\.role === 'admin'/g) || []
if (sobrou.length !== 0) {
  throw new Error(`Sobrou ${sobrou.length} decisão de carga com papel inline — deveria ser zero.`)
}
if (!src.includes(`const isAdminRole = userProfile?.role === 'admin' || userProfile?.role === 'super_admin'`)) {
  throw new Error('isAdminRole (validação de presença) sumiu — ela NÃO é sobre carga e tem de continuar.')
}
if (src.includes('Solicite a um Administrador')) {
  throw new Error('Ainda existe "Solicite a um Administrador" — instrução que o sistema não cumpre.')
}
// Os TRÊS caminhos que avisam sobre o teto (célula, escudo da linha, Aplicar Template) passam
// pelo mesmo texto. O import não conta: é `mensagemTetoExcedido,` sem parêntese.
if ((src.match(/mensagemTetoExcedido\(/g) || []).length !== 3) {
  throw new Error('Esperava 3 chamadas a mensagemTetoExcedido (célula, escudo, template).')
}
// O quarto caminho é o lote, que não tem um servidor único para abrir pedido.
if ((src.match(/instrucaoSalvarBloqueado\(/g) || []).length !== 1) {
  throw new Error('Esperava 1 chamada a instrucaoSalvarBloqueado (Salvar Previsão).')
}

fs.writeFileSync(ALVO, CRLF ? src.replace(/\n/g, '\r\n') : src)
console.log('ScaleGrid.tsx atualizado:')
for (const t of trocas) console.log('  -', t)
