# Excluir setor que tem vínculo, e tirar o inativo das telas de escolha (29/08/2026)

Quatro pedidos do usuário no mesmo dia, todos partindo do cadastro de setor e do modal do
relógio REP.

---

## 1. "Excluir Setor" existia e não excluía quase nada

`fn_excluir_setor` (`20260827010000`) só alcança setor **sem nenhum vínculo**: qualquer FK
apontando para ele faz a função recusar e listar o que segura. A recusa é correta — metade das
FKs para `setores` é `ON DELETE CASCADE` e metade é `SET NULL`, então deixar a FK decidir apagaria
escala e anularia histórico em silêncio —, mas quem clicava recebia a lista e **não tinha ação
nenhuma a tomar a partir dela**.

Medido em produção em 29/08/2026, chamando `fn_dependencias_setor` para os **646** setores:

| FK com uso real | setores atingidos | linhas |
|---|---|---|
| `servidores.setor_id` | 250 | 1.396 |
| `logs_sistema.setor_id` | 242 | 7.598 |
| `dispositivos_rep_setores.setor_id` | 222 | 401 |
| `escala_mensal.setor_id` | 188 | 1.658 |
| `profile_setores.setor_id` | 110 | 176 |
| `marcacoes_ponto.setor_id` | 107 | 26.834 |
| `historico_transferencias` (origem + destino) | 45 / 36 | 92 / 90 |
| `setores.parent_id` | 42 | 237 |
| `solicitacoes_transferencia_servidor` (origem + destino) | 32 / 27 | 71 / 71 |
| `logs_sobreaviso.destino_setor_id` | 10 | 527 |
| `justificativas_eventos.setor_id` | 9 | 314 |
| `dispositivos_rep.setor_id` (legada) | 1 | 1 |

**Só 200 dos 646 setores eram excluíveis.** E entre os 16 já **inativos** — que são exatamente os
que alguém quer tirar do cadastro — **7 tinham vínculo** e estavam presos para sempre.

### A escolha: fusão, nunca cascata

Cascata foi descartada na conversa e continua descartada: as três maiores tabelas presas ao setor
são `marcacoes_ponto`, `escala_mensal` e `servidores`. Apagar em cascata é **destruir registro de
ponto de servidor público**, que é prova legal (Portaria 671/2021), para resolver um problema de
cadastro.

`fn_fundir_setor(origem, destino)` (`20260829110000`) move **todo** vínculo para outro setor da
mesma unidade e só então apaga o setor. A varredura é dinâmica sobre `pg_constraint`, como em
`fn_dependencias_setor`: as tabelas base do sistema não estão versionadas (armadilha 2), então
lista escrita à mão nasceria incompleta e envelheceria a cada tabela nova.

### O que a fusão RECUSA — e por quê recusar é a resposta certa

`fn_impedimentos_fusao_setor` devolve a lista antes de qualquer escrita, e a tela a consulta a
cada troca do `<select>`, para o problema aparecer enquanto ainda dá para trocar o destino:

| impedimento | motivo |
|---|---|
| destino em outra unidade | mover servidor e escala de unidade é **transferência**, com tela e regra próprias (`20260828100000`) — não pode ser efeito colateral de excluir setor |
| destino é subsetor da origem | os filhos da origem viram filhos do destino; se o destino for um deles, ele vira pai de si mesmo e o ciclo em `parent_id` trava a montagem de árvore de toda tela de setor |
| mesmo servidor com escala nos dois setores na mesma competência | a unique de `escala_mensal` é `(mes, ano, servidor_id, unidade_id, setor_id)`. Mesclar escala é decisão de escala: as duas podem ter turno no mesmo dia, e o resultado é dupla contagem de horas na folha (armadilha 23) |
| qualquer outra colisão de unicidade | a varredura acha a unique que contém a coluna de FK e conta as linhas que colidiriam |

As **duas** exceções onde a colisão é descartada em vez de recusada são `profile_setores` (PK
`profile_id+setor_id`) e `dispositivos_rep_setores` (PK `dispositivo_id+setor_id`): a linha não
carrega dado próprio, ela **é** o par. Se o usuário já tem acesso ao destino, ou o relógio já
atende o destino, a linha da origem não tem para onde ir e não tem o que perder. Sai no resumo
como `vinculos_duplicados_descartados`.

### ⚠️ A exceção no trigger de imutabilidade da marcação

`marcacoes_ponto` é INSERT-only por trigger (`20260808010000`). Sem exceção, **107 dos 646
setores** — todo setor que já teve batida — continuariam impossíveis de fundir, porque a FK
barraria o `DELETE` no fim.

A exceção criada é a mais estreita que dá para escrever, e merece ser lida com atenção por quem
mexer nisso depois:

- vale só sob o GUC `sisescala.fundir_setor`, local à transação, declarado apenas dentro de
  `fn_fundir_setor` — mesma forma do `sisescala.reparse_afd` de `20260818001000`;
- o `UPDATE` precisa alterar **exclusivamente** `setor_id`, e a comparação é
  `to_jsonb(NEW) - 'setor_id' = to_jsonb(OLD) - 'setor_id'`. É estrutural, não uma lista de campos
  que envelhece: horário, servidor, origem, dispositivo, NSR e `sintetica` continuam impossíveis
  de alterar por aqui **mesmo depois de a tabela ganhar coluna nova**.

O fato registrado não muda. O que muda é o rótulo de contexto "em que setor isso aconteceu", que
passa a apontar para o setor que absorveu o outro — a alternativa seria apontar para um setor que
não existe mais. A operação inteira vira uma linha em `logs_sistema` (`setor_fundido`), com o
de → para e a contagem por tabela.

Conferido antes de escrever: os outros dois triggers de `marcacoes_ponto`
(`trg_enfileirar_aviso_ponto`, `trg_reconciliar_apos_marcacao`) são **AFTER INSERT**, então a
fusão não dispara aviso de ponto nem reconciliação para as 26.834 marcações.

### Na tela

O modal passou a consultar `fn_dependencias_setor` **ao abrir**, em vez de descobrir o bloqueio na
recusa. Sem vínculo, o botão é "Excluir definitivamente"; com vínculo, aparece a lista traduzida
("1 servidores lotados aqui", "22 marcações de ponto") e o `<select>` de destino, e o botão vira
"Transferir e excluir". Os candidatos a destino são calculados no servidor: ativos, da mesma
unidade, sem o próprio setor e **sem os subsetores dele** — não oferecer o que a RPC vai negar.

---

## 2. Unidade e setor inativos continuavam sendo oferecidos para escolha

O gatilho foi o modal do Dispositivo REP: o `<select>` de unidade listava as 33 unidades sempre, a
inativa (`CCE - Centro de Cirurgias Eletivas HMM`) junto. Os setores daquele modal já filtravam
`ativo = true` — mas **filtrar no servidor era o erro oposto**: um relógio que atende um setor
depois desativado continuava atendendo, com a caixa **invisível** na única tela que existe para
gerenciar aquilo.

Fonte única da regra: **`src/utils/opcoesAtivas.ts`**.

| onde | comportamento |
|---|---|
| escolher onde algo vai ficar (relógio, terminal, escopo de usuário, transferência, lotação) | inativo **não é oferecido** — menos o que já está selecionado, que fica com a marca `(inativo)` |
| filtro de listagem e de relatório | inativo **continua listado**, rotulado |

⚠️ A segunda linha não é meio-termo preguiçoso: escala, folha e ponto registrados naquele setor
não deixaram de existir porque ele foi desativado, e sem a opção no filtro eles ficam
inalcançáveis pela tela.

⚠️ E manter o **já selecionado** também não é detalhe. Tirá-lo faria o `<select>` exibir vazio (ou
o primeiro item da lista) para um registro que no banco aponta para ele, e o próximo "Salvar"
gravaria uma troca que ninguém pediu — o mesmo defeito que o CLAUDE.md já registra no dropdown de
servidores da tela de usuários.

Medido em 29/08/2026: **1 unidade inativa** (de 33) e **16 setores inativos** (de 646). Nenhum
setor ativo pendurado em unidade inativa, e nenhum setor ativo com pai inativo — a árvore não
tinha ramo órfão escondido.

Aplicado em: modal do Dispositivo REP, modal do Terminal Local, tela de Usuários (escopo de
acesso), Solicitações de Transferência e Importação do RH (Pendências). Rotulado nos filtros de
Folha de Ponto, Justificativas e Servidores.

---

## 3. Escolher setor no modal do relógio dava trabalho demais

A lista era plana, com a hierarquia aparecendo só como recuo dentro do texto (`↳ `). O HMM tem
**196 setores em 40 raízes e 3 níveis** — marcar um bloco inteiro era caçar e clicar dezenas de
caixas, sem enxergar onde um ramo terminava.

**`src/components/setores/SeletorSetoresArvore.tsx`**: árvore de verdade, com

- expandir/recolher por nó (mais "Expandir tudo" / "Recolher tudo");
- **marcar um pai marca todos os descendentes**, e desmarcar idem — a operação que o caso
  dominante pede ("este relógio atende a ALA - PSICOSSOCIAL inteira");
- estado **parcial** (o traço da caixa) quando só parte do ramo está marcada, com contador
  `marcados/total` ao lado do pai;
- "Marcar todos" / "Limpar" e um campo de filtro por nome — durante a busca o ramo fica sempre
  aberto, senão o resultado sumiria atrás de um nó recolhido.

⚠️ **"Toda a unidade" virou um MODO, e não `setorIds.length === 0`.** Enquanto era derivado da
lista vazia, o botão "Limpar" da árvore trocava o significado do formulário sem ninguém pedir:
desmarcar o último setor voltava para "toda a unidade" e a árvore sumia da tela. O banco continua
guardando as duas coisas do mesmo jeito (nenhuma linha em `dispositivos_rep_setores`), mas agora
salvar sem setor nenhum é **recusado** com mensagem, em vez de virar "toda a unidade" em silêncio.

### A tela /setores ganhou o mesmo tratamento

Os nós de setor já expandiam um a um, mas com **40 setores principais** só no HMM e **33 unidades
na página**, faltava o que o modal recebeu:

- **"Expandir tudo" / "Recolher tudo"** por unidade (alcança só os nós que têm subsetor);
- **card de unidade recolhível** — o cabeçalho inteiro virou o botão, com chevron —, mais
  "Recolher todas as unidades" / "Expandir todas" na barra de filtros e o contador
  "N de M unidades abertas". O estado guardado é o **recolhido**, não o aberto: assim o padrão
  continua sendo tudo aberto (como a tela sempre foi) e unidade nova não nasce escondida.

⚠️ **A busca estava respondendo "onde está" tirando justamente a resposta.** O filtro derrubava o
pai que não casava com o termo, e o laço que monta a árvore promove a raiz todo setor cujo pai não
está na lista — então procurar por um subsetor o mostrava **solto** na raiz da unidade, sem o ramo
a que pertence. Agora os **ancestrais de quem casou entram junto**, e ramo e unidade ficam abertos
enquanto houver busca (recolhidos, esconderiam o resultado que a busca trouxe).

---

## 3b. "Onde estão as horas" virou link para a escala

No relatório **Carga Consolidada do Mês**, a coluna que diz onde a pessoa está escalada
("289h — HMI / SHL \ ACOLHIMENTO") era texto puro: para chegar na grade era preciso decorar
unidade e setor, voltar em Escalas e procurar. Quem aparece nessa lista está **acima do teto**,
ou seja, alguém precisa abrir aquela escala para reduzir.

`fn_carga_mensal_servidor` já devolvia `unidade_id` e `setor_id`; era o `jsonb_build_object` de
`fn_carga_mensal_consolidada` que não os repassava. `20260829130000` acrescenta as duas chaves —
**`CREATE OR REPLACE` puro, sem o `DROP`** da versão anterior (a lista de colunas do
`RETURNS TABLE` não muda, porque as chaves entram dentro do jsonb; derrubar a função deixaria o
relatório quebrado para quem estivesse consultando durante a aplicação). Gerada por
`scratchpad/gen_carga_link.js`, cópia mecânica com conferência estrutural — o `diff` contra a
migration vigente são exatamente três linhas.

⚠️ **A primeira versão mexeu SÓ no jsonb e morreu ao aplicar**, com
`42703: column c.unidade_id does not exist`: a CTE `carga` projeta uma **lista explícita** do
retorno de `fn_carga_mensal_servidor`, e a coluna precisa entrar lá também. Não apareceu em
`tsc`, `lint`, `build` nem na conferência estrutural do gerador — SQL não resolve nome de coluna
no `CREATE` (armadilha 1). O gerador passou a **abortar** se qualquer uma das duas âncoras não
aparecer exatamente uma vez, e o `diff` contra a vigente agora são cinco linhas: o
`CREATE OR REPLACE`, duas na CTE e duas no jsonb.

Conferido em produção depois: `fn_carga_mensal_servidor` devolve mesmo
`servidor_id, escala_mensal_id, unidade_id, setor_id, unidade_nome, setor_caminho, status, horas,
sobreavisos`.

A tela monta `/escalas/unidade/{unidade_id}?setor={setor_id}&mes={mes}&ano={ano}`, o mesmo padrão
que Home, Auditoria e a ficha do servidor já usam. **Sem os ids, a linha continua renderizando sem
link** — é o que segura a tela enquanto a migration não é aplicada.

---

## 3c. O histórico de sobreaviso oferecia acionar um plantão que já passou

Clicar no ícone roxo de um dia com vários chamados abre o **Histórico de Acionamentos**. Ele é
para consulta — mas trazia "Novo Acionamento neste Dia" **sempre habilitado**, inclusive num
plantão de semanas atrás.

Isso era deliberado e está registrado no próprio código: na Fase 8 do plano de sobreaviso a
heurística de janela do frontend foi **removida** porque divergia da do banco, e preferiu-se
"deixar a RPC recusar com o horário exato — melhor um erro preciso do que um botão cinza sem
explicação". A premissa que caiu é a outra metade da frase: num dia passado o botão **convida** a
fazer algo impossível, e quem clica só descobre depois de escrever o motivo do chamado.

✅ **Nada era gravado.** `fn_acionar_sobreaviso` já recusa (`v_agora < v_jan_inicio OR v_agora >=
v_jan_fim`) com "Fora da janela do plantao. Este sobreaviso vale das X as Y". O defeito era de
oferta, não de dado.

A correção **não** reintroduz heurística: o modal consulta `fn_janela_sobreaviso_dia` — a **mesma**
função que `fn_acionar_sobreaviso` usa para autorizar — pela linha de `escala_diaria` daquele dia,
e desabilita o acionamento quando `agora` está fora do intervalo. O botão cinza vem **com** a
explicação: "Este plantão valia de 02/08/2026 07:00 até 03/08/2026 07:00. Fora dessa janela o
acionamento não é permitido — este histórico é apenas para consulta", apontando o caminho que
continua valendo (**Validar Este Chamado (Manual)**, que é como se registra atendimento passado).

Medido em produção no caso do print (FERNANDO MARCULINO, 08/2026, SMS \ TI):

| dia | janela real | acionável agora? |
|---|---|---|
| 2 | 02/08 07:00 → 03/08 07:00 | não (passou) |
| 29 (hoje) | 29/08 19:00 → 30/08 07:00 | não (ainda não começou; libera sozinho às 19h) |

⚠️ **"Reenviar Notificação / Link" carrega a mesma trava**, e não é firula: aquele botão **reabre o
modal de acionamento** com o motivo preenchido, ou seja, gera chamado novo — não é um reenvio
passivo do link antigo.

⚠️ **Pendência conhecida:** o botão de raio da própria célula da grade (`isTriggerAllowed`) ainda
decide por **heurística de prefixo de código** (`code.startsWith('N')` → 19h–07h, etc.), que é
justamente o que a Fase 8 tirou do modal. Nos casos medidos ela coincide com a janela real, mas é
uma segunda conta para a mesma pergunta — e neste projeto duas contas já divergiram. Alinhá-la
exige carregar a janela do mês inteiro, não de um dia.

---

## 4. O hostname da máquina do coletor não leva ninguém até ela

A tela já mostrava `máquina: HMM-CCE-NI`, e quem precisa acessar aquele computador não tem como
chegar nele só com o nome: não há DNS interno cobrindo as 23 unidades. O que existia no banco era
`endereco_ip` (o **relógio**) e `ultimo_ip_origem` — que é o **IP público** da unidade. Medido em
29/08/2026: os 23 dispositivos têm `45.173.x`/`177.55.x` ali, e as **cinco máquinas do HMI
aparecem com o mesmo `45.173.175.9`**. Nenhum dos dois abre sessão remota na máquina certa.

`dispositivos_rep.coletor_ip` (`20260829120000`) guarda o IP da máquina **na rede da unidade**,
reportado no heartbeat pelo coletor **v0.13.0**.

⚠️ **O IP é descoberto por `net.Dial("udp", <relógio>)`, que não envia pacote nenhum** — só faz o
sistema escolher a rota e revelar qual interface seria usada. É o único jeito confiável numa
máquina com várias placas: medido na máquina de dev, a varredura de interfaces devolvia primeiro
um `169.254.87.133` (link-local de adaptador virtual, sem rota para lugar nenhum), enquanto o Dial
devolveu o `10.110.2.111` correto. O fallback por varredura ficou, mas pulando loopback **e**
link-local.

Coletor anterior à v0.13.0 não manda o campo: a coluna fica `NULL` e a tela simplesmente não
mostra — nunca um valor inventado pelo servidor.

---

## Estado da entrega

- `20260829110000_fundir_setor.sql` e `20260829120000_coletor_ip_local.sql` **não foram aplicadas**
  — nem em homologação (a tentativa foi barrada pelo ambiente) nem em produção. O código do app já
  está no lugar e falha de forma legível enquanto as funções não existirem.
- Coletor **v0.13.0** compilado (`tray` subsystem 2 = GUI, `cli` subsystem 3 = console),
  `dist/VERSION` em `0.13.0`, `npm run build` conferido com o binário e o VERSION dentro de
  `.next/standalone`.
- ⚠️ Publicar a v0.13.0 faz o parque **se atualizar sozinho** em até 24h + atraso sorteado
  (auto-update da v0.12.0). A mudança do coletor é de uma função só (o IP no heartbeat), mas o
  risco é o de sempre: um release ruim alcança as máquinas que ninguém alcança fisicamente.
