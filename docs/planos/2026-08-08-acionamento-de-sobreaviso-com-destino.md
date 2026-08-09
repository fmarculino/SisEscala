# Acionamento de sobreaviso: painel global, popup e destino do chamado

**Data:** 08/08/2026
**Status:** ✅ **as 5 migrations foram aplicadas pelo usuário em homologação E em produção em
08/08/2026**, e conferidas por sonda (seção "Conferência pós-aplicação"). `npx tsc --noEmit` e
`npm run build` passam. Falta o teste de tela com um coordenador real.

**Decisão do usuário (08/08/2026):** abrangência por plantão — todos **veem** todos, mas só
aciona fora do próprio escopo quem aciona um sobreaviso marcado como **geral**, e o marcador
mora no **setor**. Ver seção 5.

## Conferência pós-aplicação (08/08/2026, homologação e produção)

| conferência | homologação | produção |
|---|---|---|
| 7 colunas novas em `logs_sobreaviso` | ✅ | ✅ |
| `setores.sobreaviso_abrangencia` | ✅ | ✅ |
| as 6 funções respondem por RPC | ✅ | ✅ |
| backfill: registros sem destino | **0** de 16 | **0** de 522 |
| backfill: destino ≠ origem (deve ser 0 logo após) | 0 | 0 |
| setores marcados `geral` | 1 (SMS / TI) | 1 (SMS / TI) |
| janela sobre todos os Sobreavisos reais | `N12` 19:00+12h · `D12` 07:00+12h · `MTNS` 07:00+24h, **100% fonte `slots_codigo`** | idem, 67 registros |
| `get_sobreaviso_details` devolve `origem` e `acionado_por` | ✅ | ✅ |

Sondas de comportamento (em homologação, com limpeza — nenhuma linha permaneceu):

| defesa | resultado |
|---|---|
| índice único de chamado em aberto | INSERT duplicado **recusado** (409, `uq_sobreaviso_chamado_aberto`) |
| FK composta do par (setor, unidade) de destino | setor de outra unidade **recusado** (`fk_logs_sobreaviso_destino_setor`) |
| gatilho de destino padrão | INSERT sem destino → destino preenchido com unidade **e** setor da origem |
| CHECK `destino_setor_id` exige unidade | UPDATE zerando a unidade **recusado** (400) |

⚠️ **Não verificado programaticamente:** as policies de `logs_sobreaviso` (que o `INSERT` direto
deixou de existir). Precisa de um JWT de coordenador — a service role passa por cima da RLS e a
anon não chega a ser avaliada. Rodar a consulta do rodapé de `20260808180000`:
`SELECT policyname, cmd FROM pg_policies WHERE tablename = 'logs_sobreaviso';` — devem aparecer
SELECT, UPDATE e DELETE, e **nenhuma** com `cmd = INSERT`.

## Entregue

| # | migration / arquivo | o que faz |
|---|---|---|
| 1 | `20260808150000_add_fn_janela_sobreaviso_dia.sql` | fonte única da janela de Sobreaviso |
| 2 | `20260808160000_add_destino_e_abrangencia_sobreaviso.sql` | colunas de destino, `acionado_por`, `setores.sobreaviso_abrangencia`, backfill |
| 3 | `20260808170000_geofence_do_sobreaviso_pelo_destino.sql` | chegada conferida contra o destino |
| 4 | `20260808180000_fn_acionar_sobreaviso.sql` | RPC de acionamento, índice único, fim do INSERT direto |
| 5 | `20260808190000_fn_painel_sobreaviso_dia.sql` | painel global + contato para o WhatsApp |
| — | `src/app/actions/sobreaviso.ts` | server actions |
| — | `src/components/sobreaviso/AcionarSobreavisoModal.tsx` | modal único, usado pelo painel e pelo ScaleGrid |
| — | `src/app/(dashboard)/home/_components/SobreavisoPanel.tsx` | painel do dashboard |

**Portão da Fase 1, rodado antes de aplicar:** a função nova foi replicada em JS e comparada com
as duas heurísticas do frontend sobre **os 67 Sobreavisos de produção** (todas as competências).
`N12` 19:00+12h · `D12` 07:00+12h · `MTNS` 07:00+24h — **0 divergências** contra o dashboard e
**0** contra o ScaleGrid.

**Achado fora do escopo, corrigido junto:** o relatório `plantao-sobreaviso` pedia a coluna
`data_hora_chamado`, que **nunca existiu** (o nome é `data_hora_acionamento`). O PostgREST
respondia **400** e o código caía num `|| []` — o relatório vinha tratando *todo* sobreaviso como
não acionado, sem erro visível. Conferido direto contra produção. Corrigir só o nome, porém,
trocaria um erro por outro: os 509 artefatos entram com status `Chegou` e o relatório passaria de
"nenhum acionado" para "quase todos". Por isso entrou junto o mesmo filtro de acionamento real
usado em `fn_painel_sobreaviso_dia`.

## O problema, em uma frase

Quem está de sobreaviso atende a secretaria inteira, mas o sistema trata o sobreaviso como se
pertencesse à unidade da escala: só o coordenador daquele setor vê, o acionamento acontece
dentro da grade daquela escala, e o "cheguei no local" é conferido contra o GPS da unidade de
origem — não do lugar para onde a pessoa foi de fato chamada.

Três dores, nas palavras do usuário:

1. **Visibilidade.** "Eu como suporte técnico de informática atendo todas as unidades da SMS."
   Todo coordenador/admin precisa ver quem está de sobreaviso, esteja o plantão em que unidade
   estiver.
2. **Acionamento.** Hoje o botão leva para a grade da escala. Se o painel vai ser de todos,
   quem aciona pode não ter acesso àquela escala. Tem que ser um popup.
3. **Destino.** O acionado é chamado para *qualquer* unidade/setor. Hoje ele precisa ir à
   unidade de origem só para o GPS aceitar o "cheguei", e de lá se deslocar para o local real.

---

## 1. O que existe hoje (levantado no código e no banco)

### 1.1 O painel do dashboard é filtrado por escopo

[`home/page.tsx:118`](../../src/app/(dashboard)/home/page.tsx#L118) e
[`:129`](../../src/app/(dashboard)/home/page.tsx#L129) aplicam `applyAccessFilters` sobre
`logs_sobreaviso`; [`:80`](../../src/app/(dashboard)/home/page.tsx#L80) e
[`:95`](../../src/app/(dashboard)/home/page.tsx#L95) fazem o mesmo sobre `escala_diaria`.
Coordenador vê só o próprio setor.

Abaixo disso há a RLS: `20260618080000` linha 68 cria **uma** policy `FOR ALL` em
`logs_sobreaviso`, escopada por unidade/setor. Ou seja: mesmo que o frontend pare de filtrar,
o banco continua filtrando.

### 1.2 A janela de horário do sobreaviso está duplicada — e não tem fonte no banco

| onde | como decide |
|---|---|
| [`home/page.tsx:215-249`](../../src/app/(dashboard)/home/page.tsx#L215-L249) `getShiftWindow` | lista fixa de códigos (`N12`, `SN`, `MTNS`, `D24`, `M6`, `T6`, `T4`, `D12`, `SD`) |
| [`ScaleGrid.tsx:4260-4276`](../../src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx#L4260-L4276) | heurística **diferente**, por prefixo (`code.startsWith`) |

E o banco **não tem** a resposta: `fn_blocos_previstos_dia` (`20260808040000`, linha 265) filtra
`ed.categoria IN ('Regular','Plantão','Extra')` — Sobreaviso fica de fora **por construção**
(armadilha 6). Os 5 códigos de sobreaviso do dicionário (`MTNS`, `D12`, `N12`, `M6`, `T6`) têm
`horario_inicio = NULL`, e ancorá-los é proibido: as migrations de âncora abortam de propósito.

Consequência direta para este trabalho: **se o botão "Acionar" passa a depender da janela ativa,
a janela precisa de uma fonte única — e ela ainda não existe.** Habilitar o botão por uma
heurística e validar no servidor por outra é o mesmo erro que o portão de conferência da Fase 2
do REP existe para evitar.

Detalhe aproveitável: `escala_diaria.hora_inicio_prevista` já existe e **vale para Sobreaviso**
(a constraint `chk_hora_prevista_nao_regular` só barra `Regular`). O dashboard hoje **ignora**
essa coluna — não a inclui no `select`.

### 1.3 O acionamento é um INSERT direto do navegador

[`ScaleGrid.tsx:1569`](../../src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx#L1569):

```ts
supabase.from('logs_sobreaviso').insert({ servidor_id, unidade_id, escala_mensal_id, dia,
                                          motivo_acionamento, status: 'Aguardando' })
```

Com a policy `FOR ALL`, qualquer coordenador pode gravar **qualquer** linha nessa tabela dentro
do escopo dele — inclusive `status = 'Chegou'` sem GPS, sem token, sem ninguém aceitar nada. A
trava de "já tem chamado em aberto" existe **só no frontend**
([`ScaleGrid.tsx:4258`](../../src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx#L4258)),
e a de janela ativa também.

Isso é tolerável enquanto o acionamento mora dentro da escala e só o dono do setor chega lá.
**Abrir o painel para toda a secretaria transforma isso em risco real**, e cria uma corrida:
dois coordenadores de unidades diferentes acionando a mesma pessoa ao mesmo tempo.

### 1.4 O geofence resolve o local pela escala, não pelo chamado

`20260624000000` — `register_sobreaviso_arrival` e `get_sobreaviso_details`:

```sql
COALESCE(s.latitude, u.latitude)   -- s = setor de escala_mensal, u = unidades via l.unidade_id
```

É exatamente a dor 3. E tem um agravante: se o local resolvido **não tem coordenada**, o `IF
v_unidade_lat IS NOT NULL` engole a validação inteira e a chegada é aceita de qualquer lugar,
gravando `tipo_validacao_chegada = 'GPS'` do mesmo jeito. Em homologação, **0 de 23 setores** têm
latitude/longitude (5 de 5 unidades têm). O relatório não distingue "validado dentro do raio" de
"aceito porque não havia referência".

### 1.5 A tabela não registra quem acionou nem para onde

`logs_sobreaviso` tem 29 colunas. Tem `validado_por` (quem validou a chegada na mão), mas **não
tem `acionado_por`**. Enquanto só o dono do setor aciona, dá para inferir. Com o painel global,
não dá — e a auditoria fica sem o dado mais básico do evento.

---

## 2. Críticas e sugestões ao desenho proposto

**2.1 Manter `unidade_id` como origem; destino é campo novo.** A tentação é sobrescrever
`unidade_id` com o destino. Não fazer isso: `unidade_id` é o que a RLS, a folha e o relatório
`plantao-sobreaviso` usam para dizer de quem é o plantão. Destino entra em colunas próprias, e
os 522 registros existentes recebem `destino = origem` no backfill — o histórico não muda de
sentido.

**2.2 Mostrar o período inteiro, não só "Inicia às 19:00".** O usuário pediu para continuar
vendo quem ainda não está ativo. O texto útil é a janela fechada — `19:00 → 07:00` — e não só o
início. Quem vai acionar precisa saber até quando aquela pessoa está disponível.

**2.3 Ordenar por "minha unidade" primeiro.** Painel global de 16 unidades vira ruído. Sugestão:
ativos primeiro, e dentro dos ativos os da unidade de quem está olhando antes dos demais, com
rótulo visível da unidade de origem. Sem esconder nada.

**2.4 Não devolver telefone no payload do painel.** Hoje o telefone vem no `select` porque o
WhatsApp é montado no cliente. Painel global significaria expor o telefone de todo servidor de
sobreaviso da secretaria a todo coordenador. O envio deve virar server action que resolve o
telefone no backend a partir do `log_id`.

**2.5 Registrar se o geofence foi realmente aplicado.** Duas colunas baratas
(`chegada_distancia_metros`, `chegada_geofence_aplicado`) e o relatório passa a poder provar a
chegada — ou admitir que não pode. Sem isso, adicionar destino só muda *qual* coordenada nula
está sendo ignorada.

**2.6 O ponto de referência livre.** Unidade + setor nem sempre bastam ("almoxarifado do fundo",
"CPD do 2º andar"). Um campo texto opcional `destino_referencia` custa nada e evita ligação
telefônica.

**2.7 Nem todo sobreaviso é da secretaria.** Ver seção 5 — decidido.

---

## 3. Modelo proposto

```
logs_sobreaviso
  unidade_id            -> ORIGEM: a unidade da escala. Inalterada. RLS e relatorios.
  destino_unidade_id    -> para onde a pessoa foi chamada
  destino_setor_id      -> opcional
  destino_referencia    -> texto livre opcional
  acionado_por          -> profiles(id), quem acionou
  chegada_distancia_metros / chegada_geofence_aplicado  -> prova da chegada
```

Resolução do local de chegada (primeiro não-nulo vence):

```
destino_setor.coords -> destino_unidade.coords -> setor_da_escala.coords -> unidade_da_escala.coords
```

O último par é só compatibilidade com os registros antigos.

---

## 4. Fases

### Fase 0 — Conferência em produção ✅ *(feita em 08/08/2026, com autorização)*

**Schema.** `logs_sobreaviso` tem 29 colunas em produção — **idênticas** às de homologação
(nenhuma divergência nos dois sentidos). Nenhuma das colunas novas existe.
`escala_diaria.hora_inicio_prevista` existe. `setores.sobreaviso_abrangencia` não existe.

**Geolocalização.** 16 de 16 unidades têm coordenada. Apenas **5 de 57 setores** têm. Mas
**zero** setores ficam sem referência: o fallback para a unidade sempre resolve. Ou seja, o
destino sempre terá geofence — por setor em 5 casos, por unidade nos outros. Raio de 100 m em
todas as unidades e nos 5 setores.

**Ruído do painel global — não existe.** 48 dias-servidor de sobreaviso em 08/2026, média de
**1,5 por dia** (mín. 1, máx. 5). Todos na **SMS**, em três setores:

| dias | setor de origem |
|---|---|
| 33 | TECNOLOGIA DA INFORMAÇÃO |
| 14 | CAF - CENTRAL DE ABASTECIMENTO FARMACEUTICO |
| 1 | TRANSPORTE |

Nenhum sobreaviso clínico de unidade existe ainda. A abrangência (seção 5) não bloqueia ninguém
hoje — é rede de segurança para quando o HMM entrar.

**Janela.** Só três códigos em uso: `N12` (29), `D12` (16), `MTNS` (3). Todos com
`horario_inicio = NULL`, e **0 de 48** com `hora_inicio_prevista` preenchida. Os níveis 1 e 2 da
precedência estão vazios hoje — quem resolve tudo é o nível 3 (slots/código). As duas heurísticas
do frontend concordam entre si **para esses três códigos**; a duplicação ainda é dívida, mas não
está produzindo divergência hoje.

**Os "522 acionamentos" não são 522.** Separando por `motivo_acionamento`:

| linhas | o que é |
|---|---|
| 325 | artefato de validação manual de presença |
| 183 | artefato do terminal ("O próprio usuário confirmou sua presença…") |
| 1 | artefato de validação manual na grade |
| **13** | **acionamento real — um coordenador digitou um motivo** |

Dos 13 reais: **9 usaram o link mágico** e **8 registraram chegada com GPS**. O fluxo é usado —
o que o número inflado escondia. *(Corrige o `CLAUDE.md`, que registra "522 acionamentos, 514
Manual, 8 GPS" como se fossem todos acionamentos.)*

**A prova do problema do destino, medida.** As 8 chegadas com GPS foram todas conferidas contra
o **setor TECNOLOGIA DA INFORMAÇÃO** (um dos 5 com coordenada própria, raio 100 m), e todas
foram registradas a **12–73 m dele**. Só que o destino real não era ali:

| motivo digitado | destino real | onde o "cheguei" foi registrado |
|---|---|---|
| "Enfermeira zezinha sem internet" | USF ENFERMEIRA ZEZINHA | **3.308 m** do destino, 13 m da sala da TI |
| "Emerson Cassele sem internet" | USF EMERSON CASELLI | **3.954 m** do destino, 13 m da sala da TI |

Isto é exatamente a dor 3, em dados de produção: o servidor tem de ir até a sala da TI para o
botão aceitar, e só então se desloca para o local do chamado.

Consequência que o plano precisa assumir: **`data_hora_chegada` hoje mede a chegada no lugar
errado.** O `sobreaviso_tempo_chegada_minutos` (90 min) está cronometrando o deslocamento até a
sala da TI, não até o incidente. Corrigir o ponto de referência corrige o prazo junto — e pode
fazer chamados que hoje "chegam" no prazo passarem a estourar. É efeito desejado, mas precisa
ser avisado a quem opera antes de ligar.

### Fase 1 — Fonte única da janela de sobreaviso *(SQL, sem efeito visível)*

`fn_janela_sobreaviso_dia(p_escala_diaria_id uuid)` → `(inicio timestamptz, fim timestamptz)`,
`STABLE`, sem escrita. Precedência:

1. `escala_diaria.hora_inicio_prevista` (já existe, já vale para Sobreaviso, hoje ignorada);
2. `dicionario_turnos.horario_inicio` (hoje `NULL` nos 5 códigos — deixa a porta aberta);
3. slots/código, replicando o que `getShiftWindow` faz hoje.

Duração por `horas_computadas`. Timezone de `configuracoes_globais`, não hardcoded.

**Não toca `fn_confirmar_presenca*` nem `fn_blocos_previstos_dia`** — função nova, ao lado
(armadilha 1).

*Portão:* rodar a função sobre todos os sobreavisos de 07 e 08/2026 e comparar com o que o
dashboard calcula hoje. Toda divergência precisa de explicação escrita antes de seguir.

### Fase 2 — Colunas de destino, de auditoria e de abrangência

Migration com as 6 colunas da seção 3 + backfill `destino_unidade_id = unidade_id`,
`destino_setor_id = escala_mensal.setor_id`. `acionado_por` fica `NULL` no histórico — é honesto,
o dado nunca existiu.

Mais `setores.sobreaviso_abrangencia text NOT NULL DEFAULT 'unidade'` com
`CHECK (sobreaviso_abrangencia IN ('geral','unidade'))` — ver seção 5. O default fecha por
padrão: nenhum setor vira acionável por toda a secretaria sem alguém marcar.

Congelar também a abrangência **no momento do acionamento**
(`logs_sobreaviso.abrangencia_no_acionamento`). Se o setor for remarcado depois, o histórico
continua explicando por que aquele acionamento foi permitido — o mesmo princípio de
`marcacoes_ponto` ser INSERT-only.

### Fase 3 — Geofence pelo destino

Recriar `register_sobreaviso_arrival` e `get_sobreaviso_details` com a cadeia de resolução da
seção 3, gravando `chegada_distancia_metros` e `chegada_geofence_aplicado`. Sem coordenada:
continua aceitando (comportamento atual), mas grava `false` — deixa de ser invisível.

### Fase 4 — RPC de acionamento *(fecha o INSERT direto)*

`fn_acionar_sobreaviso(...)`, `SECURITY DEFINER`, valida na ordem:

1. `auth.uid()` é `super_admin`/`admin`/`coordenador`;
2. existe `escala_diaria` de categoria `Sobreaviso` naquele (escala, dia);
3. **abrangência** — o setor de origem é `geral`, **ou** quem aciona tem acesso àquela
   unidade/setor pela regra de escopo vigente (a mesma da RLS de `logs_sobreaviso`);
4. `now()` dentro de `fn_janela_sobreaviso_dia` — **a mesma função que pinta o botão**;
5. não há chamado `Aguardando`/`Aceito` para aquele servidor no dia — a mensagem de erro diz
   **quem** acionou e **para onde**, em vez de só recusar;
6. destino existe e, se houver setor, ele pertence à unidade de destino;
7. INSERT com `acionado_por = auth.uid()`, `unidade_id` = origem e
   `abrangencia_no_acionamento` = a abrangência lida no passo 3.

O passo 3 é a regra decidida na seção 5, e é **regra de banco** — não estado de botão. A
abrangência restringe **quem aciona**, nunca **para onde**: um sobreaviso de unidade continua
podendo ser chamado para qualquer destino.

Mais um índice único parcial em `(servidor_id, escala_mensal_id, dia) WHERE status IN
('Aguardando','Aceito')` para fechar a corrida de dois acionadores simultâneos — a checagem no
passo 4 sozinha não é atômica.

Depois disso, tirar o `INSERT` da policy `FOR ALL` de `logs_sobreaviso` (quebrando-a em
SELECT/UPDATE/DELETE). ⚠️ Conferir antes que `fn_confirmar_presenca` e
`fn_confirmar_presenca_manual` continuam inserindo — as duas são `SECURITY DEFINER` e passam por
cima da RLS, mas isso tem que ser verificado, não presumido.

### Fase 5 — RPC de leitura do painel

`fn_painel_sobreaviso_dia()`, `SECURITY DEFINER` com guard de role, devolve ontem+hoje de **toda
a secretaria**: servidor, unidade/setor de origem, código do turno, janela (Fase 1), status do
último chamado, destino do chamado ativo, e `acionado_por`. **Sem telefone** (crítica 2.4).

Devolve também `pode_acionar boolean` e `motivo_bloqueio text`, calculados pela **mesma** lógica
do passo 3 da Fase 4. O frontend não recalcula abrangência — só pinta o que a RPC disse. É o
mesmo princípio de `fn_projecao_marcacoes_dia` ser fonte única de reconciliar e conferir.

O envio do WhatsApp vira server action `enviarAcionamentoSobreaviso(logId)` que resolve telefone
e provedor no servidor. O provedor por unidade (`unidade_comunicacao_<id>`) segue o da **unidade
de origem** do plantão — é a que já tem canal configurado para aquela equipe.

### Fase 6 — Dashboard: painel global + popup

- `home/page.tsx` passa a consumir a RPC; saem os `applyAccessFilters` do sobreaviso e a
  `getShiftWindow` local;
- card mostra `19:00 → 07:00` em vez de `Inicia às 19:00`;
- botão **Acionar** habilitado só quando a RPC devolve `pode_acionar = true` (janela ativa, sem
  chamado aberto, abrangência permitida); fora disso o card **continua listado**, com o período
  — que é o pedido explícito do usuário — e o `motivo_bloqueio` como tooltip;
- sobreaviso de outra unidade marcado como `unidade` aparece visível e desabilitado, dizendo a
  quem pertence. Ver e não poder acionar é informação útil, não erro;
- novo componente client `AcionarSobreavisoModal`: servidor, motivo, **destino** (unidade +
  setor, pré-selecionados com `profiles.unidade_id`/`setor_id` de quem aciona), referência
  livre; depois do submit, link + botões de WhatsApp como hoje.

### Fase 7 — Tela do acionado `/sobreaviso/[token]`

"Você foi acionado para:" passa a mostrar **destino** (unidade — setor — referência). Botão
"Registrar Chegada **na Unidade**" → "**no Local**". A mensagem de fora-do-raio cita o destino.
O texto do WhatsApp inclui o destino.

### Fase 6b — Cadastro da abrangência

Campo na tela de setores: **"Sobreaviso deste setor atende"** → `Somente esta unidade` (padrão)
× `Toda a secretaria`. Só `super_admin`/`admin` altera — é a chave que abre o acionamento para
fora da unidade.

Marcar de saída apenas o setor de Informática da SMS, que é o caso que originou o pedido. O
resto entra pelo default e é remarcado sob demanda.

### Fase 8 — ScaleGrid e relatório

O modal da grade passa a usar o mesmo componente e a mesma RPC; some a segunda heurística de
janela (linha 4260). O relatório `plantao-sobreaviso` ganha as colunas de destino e a distinção
de geofence aplicado.

---

## 5. Abrangência: quem pode acionar quem *(decidido em 08/08/2026)*

**Ver é global. Acionar é por abrangência.**

| abrangência do sobreaviso | quem vê | quem aciona |
|---|---|---|
| `geral` (TI, manutenção, suporte) | todos os coordenadores e admins | todos os coordenadores e admins |
| `unidade` (clínico, próprio da unidade) | todos os coordenadores e admins | só quem tem escopo naquela unidade/setor |

O que a decisão evita: o painel global também lista o sobreaviso clínico de cada unidade, e sem
essa regra um coordenador de UBS passaria a poder acionar o plantonista de outro hospital sem
nenhum atrito. Ver não faz mal — acionar faz.

### Onde mora o marcador

Proposta: **`setores.sobreaviso_abrangencia`**, não no turno nem na escala mensal.

A abrangência é propriedade da **equipe**, não do dia nem do código: `N12` é o mesmo código para
o plantonista de TI e para o clínico do HMM, então marcar no `dicionario_turnos` não separa os
dois. Marcar na `escala_mensal` obrigaria a redecidir todo mês, e marcar na `escala_diaria`
todo dia. O setor é onde "a equipe de sobreaviso da Informática" de fato existe, e a tela de
setores já é lugar de cadastro.

Default `'unidade'`: fecha por padrão, abre por decisão explícita de quem administra.

Se um dia aparecer um caso de sobreaviso geral **temporário** (um mutirão, uma campanha), o
lugar de acrescentar o override é `escala_mensal`, sem tirar o campo do setor. Não antecipar
isso agora.

### O que a abrangência **não** restringe

O **destino**. Um sobreaviso de unidade continua podendo ser chamado para qualquer
unidade/setor — a pessoa é da equipe daquela unidade, mas o problema pode estar em outro
prédio. Abrangência responde *quem chama*; destino responde *para onde vai*. São eixos
independentes e não devem ser fundidos.
