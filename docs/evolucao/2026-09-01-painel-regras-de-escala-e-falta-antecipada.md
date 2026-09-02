# Painel truncado, hora extra sem base certa, servidor afastado escalável e falta congelada em "aguardando" (01/09/2026)

Seis correções/funcionalidades na mesma sessão, todas nascidas de relatos do usuário sobre a
tela em uso real (não de auditoria de código). Versão **v2.34.0**.

## 1. Painel de Controle contando com o corte de 1000 linhas do PostgREST

**Relato:** os cartões de "Servidores", "Escalas Ativas" e "Afastados Agora" no `/home` pareciam
errados. O card de Servidores mostrava **996 Ativos + 2 Inativos = 998** — perto demais do teto
de 1000 linhas que o PostgREST devolve por padrão, em silêncio, sem `.range()` (a mesma armadilha
8 já documentada no `CLAUDE.md`, aqui num quinto lugar diferente do código).

`serversQuery = supabase.from('servidores').select('status')` buscava a tabela inteira sem
paginar e filtrava em JS — com mais de 1000 servidores cadastrados, a segunda metade nunca
chegava ao navegador. `escalasQuery` (escala_mensal do mês corrente), `diariaTodayQuery` (escala
de hoje) e os três meses do gráfico histórico (`historicalPromises`, ~4.200 linhas de
`escala_diaria`/mês em produção) tinham o mesmo problema.

**Correção**, em `src/app/(dashboard)/home/page.tsx`:
- Servidores por status e "Em Serviço Hoje" viraram contagem exata (`count: 'exact', head: true`)
  — imune ao corte por construção, porque o corte é sobre **linhas devolvidas**, não sobre o
  header `Content-Range` da contagem. Mais barato que buscar e paginar `status` linha a linha.
- `escala_mensal` do mês (usada para o painel "Escalas de \<mês\>") e `servidores_eventos`
  (afastamentos) passaram a paginar de verdade, com `buscarTodasPaginas()` (loop de `.range()`).
- O gráfico histórico de 3 meses ganhou o mesmo tratamento — estava sub-relatando horas de meses
  fechados sem erro nenhum.
- **Achado colateral:** a consulta de afastamentos era a **única** do arquivo sem
  `applyAccessFilters` — um RH da Unidade via afastamento da Secretaria inteira nessa seção,
  mesmo com as outras já escopadas. Corrigido junto.

## 2. Hora extra deixa de aceitar Plantão como base — só Regular

**Decisão do usuário, 01/09/2026:** hora extra é extensão do expediente **Regular**. Plantão já
tem duração e pagamento próprios (unidades PL12/PL6/PL4, ver `CLAUDE.md` armadilha 16) — não
deve gerar Extra.

A regra já existia parcialmente (`handleCellChange` bloqueava Extra sem `Regular OU Plantão` no
dia), mas era só **um** dos quatro caminhos que escrevem na grade — o mesmo padrão repetido das
armadilhas 14/23/26 do `CLAUDE.md` (afastamento, sobreposição entre setores, teto de carga): uma
regra que só vale na digitação célula a célula.

Fechado nos quatro lugares, em `src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx`:

| caminho | o que mudou |
|---|---|
| `handleCellChange` | guard estreitado de `hasRegular \|\| hasPlantao` para só `hasRegular` |
| Gerador Inteligente (competência aberta) | categorias processadas em ordem fixa (Regular → Plantão → Sobreaviso → Extra, não a ordem que o motor devolveu) — Extra só entra se `Regular` já estiver no resultado FINAL do dia, seja porque já estava salvo, seja porque este mesmo lote acabou de gerar |
| `persistirMesesGerados` (competências seguintes, gravadas direto no banco) | mesmo guard, porque esse caminho nunca passa pela grade aberta |
| `handleSave` ("Salvar Previsão") | última barreira: recusa salvar se sobrar qualquer Extra sem Regular no dia, listando servidor e dia |

`src/utils/intelligentScaleGenerator.ts` ganhou o contador `puladasPorExtraSemRegular` e a linha
correspondente no resumo mostrado ao usuário ("N de Hora Extra caíram em dia sem Regular").

⚠️ **Decisão explícita, confirmada pelo usuário:** o `handleSave` bloqueia salvar qualquer escala
que **já tenha hoje** uma Extra num dia só de Plantão (dado lançado sob a regra anterior) — o
coordenador precisa remover a Extra ou lançar o Regular antes de conseguir salvar mais nada
naquela grade. Não há como medir quantos casos assim existem em produção sem consultar o banco;
não foi feito nesta sessão.

## 3. Servidor Afastado/Inativo saía escalável em unidade nova

**Relato:** WADILA SILVA SANTOS, com `status = 'Afastado'` no cadastro, aparecia em
"+ Adicionar Servidor" e podia ser inserida numa escala nova.

Causa: `todosServidores` (`escalas/unidade/[unidadeId]/page.tsx`) busca `servidores` sem filtro
de `status` — precisa mesmo, porque o mesmo array alimenta dezenas de `.find()` no `ScaleGrid.tsx`
para achar nome/cargo de quem **já está** na escala, mesmo que tenha ficado afastado depois de
escalado. O furo era só no ponto de **escolha**.

Corrigido seguindo o mesmo padrão já usado para unidade/setor inativo (`src/utils/opcoesAtivas.ts`,
adaptado aqui porque `servidores.status` é um enum de três valores, não um booleano `ativo`):
`servidoresElegiveisParaEscala` (`status === 'Ativo'`) substitui `todosServidoresSetor` nos três
lugares que oferecem/inserem — dropdown "+ Adicionar Servidor", cálculo de "disabled" de
"Adicionar Todos do Setor" e o próprio `handleAddAll`. `todosServidoresSetor` continua intacto
para todo o resto.

✅ **O fluxo "Servidor Externo" já estava correto** — `fn_buscar_servidor_para_escala` e
`get_external_servers_for_scale` já filtram `status = 'Ativo'` no banco desde antes desta sessão.
Só o dropdown local do próprio setor tinha o furo.

## 4. Fechar a folha sem justificar passa a virar falta definitiva

`src/utils/folha/faltaAutomatica.ts` já tinha o conceito de falta **pendente**
("FALTA - AGUARDANDO JUSTIFICATIVA", dentro do prazo de `justificativa_prazo_dias_uteis`) e
**definitiva** (fora do prazo). O texto é um snapshot em `folha_ponto.registros`, recalculado só
quando a folha é gerada/sincronizada — e **nada** revisitava uma folha já fechada (Revisada) para
reavaliar isso. Uma folha fechada cedo (antes do prazo vencer) congelava "aguardando" para
sempre, contando **0 faltas indefinidamente** no rodapé — caso real medido: folha de agosto/2026
de MARCELO MEDEIROS DE LIMA, dias 05 e 10, já Revisada.

**Decisão do usuário, 01/09/2026:** fechar a folha sem justificar É a decisão de que não vai
justificar. Com um alerta antes: "existem dias com falta aguardando justificativa", dando ao
coordenador a chance de corrigir, mas exigindo que ele **confirme** para prosseguir.

Implementado com o mesmo padrão de gate já usado nesta função para afastamento/sobreposição/teto
(`salvarFolhaPonto`, `src/app/(dashboard)/folha-ponto/actions.ts`):

- Novo parâmetro `confirmarFaltasPendentes?: boolean`. Ao fechar (`status: 'Revisada'`) com dias
  ainda "AGUARDANDO JUSTIFICATIVA" e sem confirmação, a action devolve
  `{ requerConfirmacaoFaltas: true, diasFaltaPendente: [...] }` em vez de fechar.
- `FolhaPontoEditor.tsx` mostra um modal com os dias pendentes e duas saídas: **Cancelar** (volta
  para a tela, os campos continuam editáveis) ou **Confirmar** (rechama `handleSave` com
  `confirmarFaltasPendentes: true`).
- Confirmado (ou sem pendência), `promoverFaltasPendentes()` (novo helper em `faltaAutomatica.ts`)
  troca cada observação pendente por `'FALTA'` definitiva, na mesma gravação.

⚠️ **Corrigi uma sugestão minha anterior, errada:** eu tinha proposto um botão "Ir para
Justificativas" no modal. `/justificativas` só cobre Extra, Plantão e Sobreaviso
(`getEventosPendentes` filtra por categoria explicitamente) — falta de dia Regular nunca teve
fila lá. O modal manda ficar na própria tela da folha.

**Fechamento automático (cron)** recebeu a mesma promoção, sem confirmação (não há quem
confirmar) — mesmo espírito de `converterPendentesEmFaltaPorDecurso` (falta de plantão por
decurso de prazo), que já fazia isso silenciosamente com log. Dois caminhos em
`src/utils/autoClose.ts`:

1. folha já existente promovida a Revisada junto com a escala expirada (antes só trocava o
   `status`, sem tocar `registros` — o gap principal);
2. fallback "segurança" que fecha folhas vencidas isoladas da escala.

Ambos gravam em `logs_sistema` (`faltas_confirmadas_por_decurso`, `reversivel_por`), mesma
convenção de auditoria da conversão de plantão.

## 5. Falta declarada com antecedência pelo coordenador

**Relato:** há casos em que o coordenador já tem certeza de que o servidor faltou (comunicado,
sem contato) e quer registrar isso logo no início do mês, sem esperar o mecanismo automático
(que só roda dentro da folha gerada/sincronizada, com um prazo de dias úteis por cima).

**Pesquisa antes de implementar:** como sistemas de ponto brasileiros (Pontotel) e soluções de
mercado tratam o mesmo problema — painel de pendências antes do fechamento e correção manual
direta no dia, sempre com justificativa registrada, nunca "empurrar a decisão para frente" sem
rastro. Confirma a direção pedida pelo usuário.

**Onde a ação mora, e por quê:** cotadas três opções — estender `/justificativas` (reaproveita a
tabela, mas aquela tela existe para **navegar uma fila que se gera sozinha** via
`fn_desfecho_eventos_escalas`; Regular nunca alimentou essa fila, e a tela não tem um fluxo de
"criar do zero"); botão na célula do editor de folha (só existe depois que a folha daquele
servidor foi gerada — o oposto de "adiantar no início do mês"); ação por servidor na lista de
`/folha-ponto` (existe desde o início do mês, é onde o conceito de falta já mora — soma
`Total Faltas`). Escolhida a terceira.

**`declararFaltaAntecipada`** (novo, `folha-ponto/actions.ts`) reaproveita `justificativas_eventos`
— mesma tabela e mesmo shape que `salvarJustificativa` já usa para Extra/Plantão/Sobreaviso — com
`categoria: 'Regular'`, que aquele módulo nunca preenchia:

- `resultado: 'falta'`, `resultado_origem: 'coordenador'` — ⚠️ a constraint do banco
  (`chk_justificativa_resultado_origem`, migration `20260824100000`) só aceita `'coordenador'` ou
  `'decurso_de_prazo'`; qualquer outro valor é recusado na gravação, não é escolha de estilo.
- Guard: recusa se o dia já tem `presenca_entrada_em`/`presenca_saida_em` — nunca declara falta
  por cima de presença real, a mesma regra de "nunca fabricar horário" do terminal de ponto, na
  direção inversa.
- Confere `hasSectorAccess` e competência encerrada, escrito com `createClient()` (sessão) — a
  RLS de `justificativas_eventos` (`fn_pode_gerir_justificativa`) já cobre coordenador, mesmo
  caminho que `/justificativas` usa hoje.
- Se a folha já existe e está aberta (Rascunho/Gerada), atualiza `registros`/`total_faltas` na
  hora. Se ainda não existe, fica só na tabela até a primeira geração.

**Para o segundo caso funcionar**, as **quatro cópias** da geração de folha (`executeGerarFolhaPonto`
e `sincronizarFolhaPonto` em `folha-ponto/actions.ts`; as equivalentes do portal,
`gerarFolhaPontoServidor` e `sincronizarFolhaPontoServidor`, em `consultar-escala/actions.ts`)
passaram a consultar `diasComFaltaDeclarada()` (novo helper em `faltaAutomatica.ts`, uma query por
geração — nunca por dia, para não virar N+1) antes de cair na lógica automática de prazo. Se o
coordenador já declarou, grava `'FALTA'` direto, pulando o prazo de dias úteis inteiro.

UI: `folha-ponto/page.tsx` ganhou um botão vermelho "Falta" em cada linha com escala (mesmo sem
folha gerada ainda), abrindo um modal com seletor de dia da competência e campo de motivo.

## 6. Gráfico "Comparativo Histórico de Horas" zerando categorias que aconteceram de verdade

**Relato:** o gráfico dizia que agosto/2026 teve **0h de Sobreaviso**, e o usuário fez sozinho
cerca de **23 sobreavisos** naquele mês.

A consulta de `historicalPromises` (item 1 acima) somava `escala_diaria.categoria` ×
`dicionario_turnos.horas_computadas` por mês, e para os **dois meses passados** (não o corrente)
exigia `escala_mensal.status = 'Fechada'` — "só conta o que já está oficialmente encerrado". O
problema: **cada `(servidor, unidade, setor, mês, ano)` tem o próprio `escala_mensal`, fechado no
próprio ritmo** (fechamento manual por competência, ou automático via cron depois de
`dias_inativacao_automatica`, padrão 5 dias após o fim do mês). Sobreaviso costuma viver numa
escala à parte (setor de coordenação, abrangência "geral") da escala Regular da mesma pessoa —
então era perfeitamente possível o Regular já estar Fechado (e aparecer no gráfico) enquanto o
Sobreaviso do mesmo mês, numa escala diferente, ainda estivesse em Rascunho (e sumir).

Confirmado em homologação (não foi possível confirmar contra produção, sem acesso): a mesma
categoria `Sobreaviso` tem linhas simultaneamente em escalas `Fechada` **e** `Rascunho` — prova
de que o corte por status descarta categoria inteira em silêncio, sem indicar que faltou algo.
Justamente no dia seguinte à virada do mês (quando este relato aconteceu), é o momento em que
mais escalas ainda estão abertas.

**Correção:** removido o filtro `status = 'Fechada'` também dos meses passados — o comparativo
passa a contar tudo que está lançado, igual ao mês corrente já fazia ("include real-time ongoing
scales"). Painel informativo não é o documento legal (esse é a folha fechada, com ciclo de
revisão próprio); esconder trabalho real da visualização por causa de uma escala específica ainda
não formalmente encerrada é pior do que mostrar um número que pode se ajustar depois.

⚠️ **Não descarta a hipótese de escopo.** Se quem vê o painel tiver acesso restrito a certas
unidades/setores (`admin` não-irrestrito), e o sobreaviso estiver numa unidade fora desse escopo,
o número continua 0 — corretamente, porque a pessoa não tem permissão para ver aquele dado. Não
foi possível descartar essa hipótese por falta de acesso a produção; se o número ainda vier
zerado após o deploy, confira o escopo da conta antes de suspeitar do código de novo.

## Verificação

`npx tsc --noEmit` e `npm run build` limpos depois de cada bloco de mudança. Sem testes
automatizados no projeto — verificação manual na grade e na folha continua pendente para quem
aplicar em produção.

## Pendências conhecidas

- Não foi medido quantas escalas/folhas em produção já têm Extra sem Regular (item 2) ou falta
  pendente antiga que o novo gate vai exigir decisão (item 4) — os dois só aparecem na primeira
  vez que alguém tentar salvar/fechar depois do deploy.
- `/justificativas` continua sem cobrir falta de dia Regular — a declaração antecipada (item 5)
  é um caminho paralelo, não uma expansão daquela tela.
