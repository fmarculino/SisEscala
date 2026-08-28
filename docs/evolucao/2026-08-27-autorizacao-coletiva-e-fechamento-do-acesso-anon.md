# 27/08/2026 — autorização coletiva do RH, fechamento do acesso anônimo e limpeza do verso da folha

Versão **v2.21.0**. Sete frentes, seis migrations. Tudo medido em produção antes e depois.

---

## 1. Gerenciamento de usuários — os filtros não filtravam

**Sintoma relatado:** filtrar por setor não mudava a lista.

**Causa:** os filtros de Unidade/Setor casavam contra o **escopo de permissão** da conta, não
contra a **lotação** que o card exibe — e com três coringas: `acesso_todos_setores`,
`acesso_todas_unidades` e "tem a unidade-pai do setor".

Medido: filtrar o setor **DMAC** devolvia **71 de 95 contas** (38 entravam só por Acesso Total,
26 só por terem a unidade), contra 7 vinculadas ao setor e 6 lotadas nele.

| filtro | antes | agora |
|---|---:|---:|
| setor SND | 59 | 1 |
| setor RECURSOS HUMANOS | 59 | 5 |
| unidade CEI | 11 | 2 |
| sem filtro | 95 | 95 |

Decisão do usuário: casar por **lotação OU vínculo explícito**, sem coringas. Contas de Acesso
Total saem do filtro de lugar e o rodapé diz quantas são e por quê.

Também: o dropdown de setores (644 setores, **79 nomes repetidos** — "RECEPÇÃO" aparece 33 vezes)
passou a ser agrupado por unidade quando nenhuma unidade está escolhida.

✅ A lista sempre mostrou todas as contas: 95 no Auth, 95 em `profiles`, nenhuma órfã dos dois
lados. A paginação de 20 em 20 é que dava a impressão de faltar gente.

---

## 2. Terminal clássico: a chave só escondia o botão

`configuracoes_globais.terminal_classico_habilitado = false` era lido apenas na sidebar e na tela
de login, para não pintar o link. A rota `/presenca` continuava servida e `fn_registrar_ponto`
continuava alcançável.

**Medido:** a chave foi desligada em **21/08/2026 00:13** e, depois disso, entraram **97 batidas
reais de 18 servidores em 2 unidades**, com 6 coordenadores supervisionando. Não havia (nem há)
terminal local cadastrado — a chave foi desligada antes de o substituto existir.

Três camadas em `20260827000000`:

| camada | o que faz |
|---|---|
| banco | `fn_registrar_ponto` recusa antes de qualquer escrita e antes de conferir o PIN |
| rota | middleware não serve mais `/presenca` (confirmado em produção: `307 → /login?terminal=desativado`) |
| tela | `/presenca` mostra "Terminal Desativado", sem formulário |

O Terminal Local não morre junto: `fn_registrar_ponto_terminal_local` publica o GUC
`sisescala.canal_ponto` antes de delegar.

⚠️ **Não é restrição de horário** (vedação 1 da Portaria 671/2021): nada aqui olha a hora da
batida. Onde o canal está ligado, a regra de nunca recusar por horário continua intacta.

⚠️ **8 dos 18 servidores não tinham nenhuma batida no relógio em agosto.** Aplicar a trava com a
chave desligada os deixa sem meio de registrar — ficou avisado ao usuário; a chave é reversível
na tela.

---

## 3. Afastamentos — achar a pessoa antes de saber onde ela trabalha

Campo de busca incremental acima de Unidade (nome, matrícula ou CPF, ignorando acentos e
pontuação). Ao escolher, unidade e setor são preenchidos juntos.

Medido: **1.318 servidores ativos** — por isso a carga é paginada por `Range` (o PostgREST corta
em 1000 em silêncio, armadilha 8) e roda em segundo plano, sem atrasar o formulário. Como "silva"
casa com 351 pessoas, os resultados são ordenados por relevância: matrícula/CPF exato primeiro,
depois nome que começa pelo termo.

---

## 4. Setor inativo aparecia nos dropdowns de escolha

`/servidores/pendencias` nunca filtrou por `ativo` (17 dos 645 setores estão inativos). Agora os
dropdowns de **escolha** (promover pendência, destino de transferência) só oferecem setor ativo;
a lista completa continua chegando para **exibir** lotação de origem já desativada, e o destino
que uma solicitação antiga já trazia continua selecionável.

Filtros de relatório não foram tocados — ali esconder inativo quebraria leitura de dado histórico.

---

## 5. Excluir setor (Administrador Geral)

Setor cadastrado errado não tinha saída: a tela só oferecia Inativar. Medido: **225 dos 645
setores não têm vínculo nenhum**.

`fn_excluir_setor` (`20260827010000`) **recusa listando os vínculos** em vez de deixar a FK agir —
parte das FKs é `ON DELETE CASCADE`/`SET NULL` e apagaria dado real em silêncio. A varredura é
dinâmica sobre `pg_constraint`: `servidores`, `escala_mensal` e `profile_setores` nasceram fora do
versionamento (armadilha 2), então uma lista escrita à mão nasceria incompleta.

---

## 6. RH edita a grade como Diretor

O bloqueio do RH não era escala fechada — era o **prazo de planejamento**: `canEditScale` liberava
só `super_admin` e `admin`. Decisão do usuário: RH Geral e RH da Unidade passam a ser tratados
como Diretor.

Fonte única nova: **`podeEditarForaDoPrazo`** (`src/utils/governance.ts`). O teste
`role !== 'admin' && role !== 'super_admin'` estava repetido em **6 lugares** do `ScaleGrid` —
essa era a armadilha de acrescentar papel. `rh_unidade` continua escopado pela RLS: liberar o
prazo não amplia o que ele enxerga.

---

## 7. Justificativa coletiva autorizada pelo RH — Ofício 249/2026

Plano: [`docs/planos/2026-08-27-dispensa-de-registro-de-ponto.md`](../planos/2026-08-27-dispensa-de-registro-de-ponto.md).

**O achado que mudou o desenho:** o "⚡ Validar em Massa" **já aceitava** vários servidores, o mês
inteiro e uma justificativa única. O coordenador nunca precisou justificar dia a dia. Faltavam
duas coisas — e são elas que viraram código.

### 7.1 A autorização (`20260827020000`)

Tabela `autorizacoes_ponto_coletivo`, **nominal por servidor** (o ofício autoriza pessoas, não
setores — servidor novo no setor não herda nada), com passos liberados, vigência, ofício e motivo
obrigatórios. Revoga-se, nunca se apaga.

Três travas no banco: `CHECK` impedindo `saida` na lista de passos (é o registro que o próprio
ofício preserva), vigência obrigatória com teto de 12 meses, e trigger contra duas autorizações
vigentes sobrepostas para a mesma pessoa. Conceder e revogar: **só RH Geral e Administrador
Geral**, conferido dentro da função.

Tela: aba **"Autorizações do RH"** em `/marcacoes`, visível a todo gestor (o coordenador precisa
ver a vigência), com os botões só para quem concede.

### 7.2 O modo restrito (`fn_atestar_passos_autorizados_bulk`)

Confere a autorização **dia a dia** (a vigência pode começar no meio do período) e declara só os
passos liberados. No modal surge o botão **🔒 Autorizado pelo RH**, que só aparece quando algum
selecionado tem autorização vigente, já traz a justificativa oficial e informa quantos estão
cobertos.

⚠️ **Não escrevi gravação nova de horário.** `fn_confirmar_presenca_manual` já aceitava
`p_tipo = 'entrada'`, `'intervalo_saida'` e `'intervalo_retorno'` isolados desde sempre, e nunca
teve chamador. A função nova a envelopa uma vez por passo — nenhuma função de presença foi
alterada (armadilha 1).

⚠️ **A saída nunca é tocada:** nenhum caminho passa `'saida'`, `'completo'`, `'periodo_1'` ou
`'periodo_2'`.

⚠️ **Armadilha encontrada:** `p_tipo = 'intervalo_retorno'` **fabrica a entrada** (início + 5h)
quando ela está nula. Se a autorização liberar retorno de intervalo **sem** liberar entrada, a
função pula o dia em que a entrada ainda não existe — senão criaria pelas costas exatamente o
horário que o desenho existe para não criar.

### 7.3 A folha cita o ofício

`src/utils/folha/autorizacaoPonto.ts`, aplicado nas **quatro** cópias da geração por gerador com
contagem. Sai `REGISTRO DE ENTRADA DISPENSADO CONF. OFÍCIO 249/2026` na observação do dia,
acrescentado ao que já havia (feriado, afastamento parcial), nunca substituindo.

### 7.4 O que falta para usar

⚠️ **3 dos 7 nomes do ofício não casam com o cadastro**: "Gessica Francielle" está como **GÉSSICA
FRANCIELE ALMEIDA BARBOSA** (mat. 68246); **Luzinete Martins** e **Nídia Evilyn** não aparecem
lotadas no Porta a Porta. A autorização é nominal — sem conferir com o RH, essas pessoas são
ignoradas pelo modo 🔒.

O grupo ainda não entrou no fluxo: 10 escalas de 08/2026, **todas em Rascunho**, zero dias
lançados, zero marcações. Dá tempo de acompanhar desde o primeiro mês.

---

## 8. 🚨 Anon executava as funções de presença

Achado ao validar o REVOKE da seção 2. Medido com a **chave anon, sem login nenhum**:

```
fn_confirmar_presenca               200  ANON EXECUTOU
fn_confirmar_presenca_manual        200  ANON EXECUTOU
fn_confirmar_presenca_manual_bulk   200  ANON EXECUTOU
fn_atestar_jornada_bulk             200  ANON EXECUTOU
fn_atestar_passos_autorizados_bulk  200  ANON EXECUTOU
fn_registrar_ponto                  200  ANON EXECUTOU
```

Ou seja: **dava para gravar presença em folha de ponto sem sessão**, com a chave que vai no
bundle do navegador.

**A causa é o padrão usado em todo o projeto.** `CREATE FUNCTION` já concede `EXECUTE` a
**PUBLIC**; `GRANT EXECUTE ... TO authenticated, service_role` é inofensivo e **inútil como
restrição**. Das 394 funções, **369 eram alcançáveis por anon** — e as 25 fechadas eram
exatamente as que escreveram `REVOKE ... FROM PUBLIC`.

⚠️ **E a primeira correção (`20260827030000`) aplicou "com sucesso" sem mudar nada**: REVOKE de
quem não é dono da função **não falha — emite WARNING e segue**. Só se descobriu medindo por fora.

Desde então, **toda migration de privilégio confere o próprio resultado e aborta**:

| migration | o que fechou | resultado medido |
|---|---|---|
| `20260827040000` | núcleo de presença (grupos A e B), com verificação | 369 → **353** visíveis a anon |
| `20260827050000` | escala, justificativas, avisos, biometria, logs (grupos C e D) | 353 → **324** |

A `050000` confere **os dois sentidos**: aborta se anon continuar entrando **e** se uma função que
a tela usa perder `authenticated` — derrubar a grade do coordenador seria trocar um problema por
outro pior, e igualmente em silêncio.

### O que ficou aberto, de propósito

`accept_sobreaviso_call`, `decline_sobreaviso_call`, `mark_sobreaviso_timeout` e
`register_sobreaviso_arrival` — a página `/sobreaviso/[token]` é **pública por desenho**: o
servidor recebe o link mágico por WhatsApp e registra chegada sem login. **As quatro exigem
`magic_token`**, que é a defesa correta ali.

### Estado final

| medida | início | fim |
|---|---:|---:|
| funções chamáveis por anon | 369 | **324** |
| dessas, que escrevem sem conferir papel | 35 | **4** (todas exigem `magic_token`) |
| ponto/folha alcançável sem login | **sim** | não |

**Tabelas:** a RLS já estava correta — todas devolvem 0 linhas para anon. A única exposta é
`configuracoes_globais`, com allowlist de **7 chaves inócuas** (logo, timezone, flags); as 52
restantes, incluindo `email_smtp_senha` e `whatsapp_astracall_key`, não aparecem.

ℹ️ **Duas contagens diferentes:** `pg_proc` diz 818 de 890 abertas, mas inclui as centenas de
funções do PostGIS e as de **trigger**, que o PostgREST não expõe como RPC. O que é alcançável de
fora são as 324 do OpenAPI.

Registrado como **armadilhas 24 e 25** no `CLAUDE.md`.

---

## 9. `fn_atestar_jornada_bulk` anunciava "0 registro(s)"

`fn_confirmar_presenca_manual_bulk` devolve **`processed_count`**; `fn_atestar_jornada_bulk` lia
`total_processed`, que nunca existiu — nas duas versões dela, desde 08/08/2026. O `COALESCE`
resolvia para 0 sempre.

Nada era gravado errado: a Validação em Massa funcionava e dizia que não tinha feito nada. É a
armadilha 22 na forma pior — **relatar zero quando mudou**. Corrigido em `20260827020000`, por
cópia mecânica com invariantes conferidos.

---

## 10. Verso da folha: 54% eram sábados e domingos

O verso listava um dia por linha sempre que `registro.observacao` tinha conteúdo — e a geração
**escreve `SÁBADO`/`DOMINGO`/`FOLGA` sozinha** em todo dia sem escala.

Medido nas **482 folhas de 08/2026**:

| linha | antes | agora |
|---|---:|---:|
| `SÁBADO` / `DOMINGO` / `FOLGA` | 6.216 | **0** |
| feriado sem trabalho no dia | 451 | **0** |
| ajuste manual de ponto | 3.221 | 3.221 |
| afastamento / atestado | 1.018 | 1.018 |
| observação escrita por alguém | 547 | 547 |
| jornada temporária | 52 | 52 |
| **total** | **11.505** | **4.838** |

Pior que o volume: essas linhas saíam com origem **"Gestão / Coordenação"** — o documento
afirmava que alguém justificou o que ninguém justificou. **85 folhas** passam a ter o verso vazio,
exibindo "Nenhuma ocorrência extraordinária ou ajuste manual registrado no período".

⚠️ **A parte humana é preservada quando vem colada no rótulo:** a geração concatena
(`AFASTAMENTO PARCIAL: DECLARAÇÃO DE COMPARECIMENTO (M) | SÁBADO`), então descartar a observação
inteira apagaria justamente o que interessa. A função separa por `|` e joga fora só os rótulos.

⚠️ **Trabalho EM feriado passa a aparecer** (com o horário), porque aí é ocorrência de verdade.
Feriado sem trabalho é calendário, e a frente da folha já mostra.

Fonte única: `src/utils/folha/ocorrencias.ts` — havia **duas cópias** do relatório, no editor da
folha e na impressão em lote, com regras diferentes entre si.

Nada disso altera dado: o verso é derivado de `folha_ponto.registros` na renderização.

---

## 11. C4 — mover batida real entre turnos do mesmo dia

Último item aberto do plano de 23/08 (C1, C2 e C3 saíram naquela data e levaram a hora extra em
dia com plantão de **75h12 para 3h21**).

`fn_reclassificar_passo_entre_turnos` (`20260827060000`) move batida **real** entre LINHAS de
`escala_diaria` do mesmo servidor e do mesmo dia — a saída classificada no expediente quando
pertencia ao plantão. `fn_reclassificar_passo_presenca` (v1) continua valendo para o caso de uma
linha só, e não foi tocada.

Guards: mesmo servidor e mesmo dia; Sobreaviso recusado; competência aberta; escopo dentro da
própria RPC; origem com batida **real**; destino **vazio**. Escreve no destino **antes** de limpar
a origem — se o destino falhar, a transação volta e a batida continua onde estava.
`marcacoes_ponto` nunca é tocada.

Medido em 08/2026: **301 dias com 2+ turnos**, **66 com alguma linha pela metade**, **55 com
batida real** para mover.

🚧 **A função está aplicada, mas ainda NÃO tem action nem tela** — não há como usá-la pela
interface. É o próximo passo desta frente.

---

## Migrations aplicadas

| migration | o que faz |
|---|---|
| `20260827000000` | trava real do terminal clássico + primeiro REVOKE (sem efeito, ver §8) |
| `20260827010000` | `fn_excluir_setor` / `fn_dependencias_setor` |
| `20260827020000` | autorizações de ponto coletivo + correção do `processed_count` |
| `20260827030000` | REVOKE sem verificação — **aplicada e sem efeito**, substituída pela seguinte |
| `20260827040000` | REVOKE de PUBLIC no núcleo de presença, com verificação que aborta |
| `20260827050000` | REVOKE grupo 2, verificando os dois sentidos |
| `20260827060000` | C4 — reclassificar passo entre turnos |

## Pendências

- **RH:** conferir os 3 nomes do Ofício 249/2026 e cadastrar a primeira autorização.
- **C4:** action + tela.
- **Auditoria das 533 marcações sintéticas** de origem `terminal` (`fn_salvar_saida_bloco`
  fabrica horários de transição) — continua aberta desde 23/08.
- **10 dias (13h30) com campo de origem `manual`** em 08/2026, que só o coordenador desfaz.
