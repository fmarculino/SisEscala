# Três relógios do HMM: o que "contagem igual" não prova (06/09/2026)

O relato de campo foi: *"os relógios 1 e 2 parecem estar sincronizados, o 3 continua diferente
tanto na quantidade de cadastros como também não pegou a digital do administrador"* — com três
fotos da tela dos equipamentos mostrando **476**, **349** e **349 usuários**.

Duas conclusões saíram invertidas depois de medir: **a sincronia de biometria estava perfeita nos
três**, e o administrador **não podia** ter sido copiado, por um motivo que nada tem a ver com o
HMM-03.

## O que a tela do equipamento mostrava, e o que estava por trás

| relógio | cadastros | com digital | pendências de cópia |
|---|---|---|---|
| HMM-01 | 349 | 235 | **0** |
| HMM-02 | 349 | 235 | **0** |
| HMM-03 | 476 | 307 | 2 — e as duas vêm do CCE-01 |

Os três estão na **mesma máquina** (`DESKTOP-9NJ3JAJ`, `10.110.4.93`, coletor v0.15.0), então a
cópia automática de biometria os alcança. O CCE-01 está em `HMM-CCE-NI` / `10.110.51.189` — outro
prédio, outra rede, e por decisão do usuário fica à parte.

**Nas últimas 24h: 467 cópias de biometria, todas `aplicada`, zero falhas**, todas pelo formato
`update_users:[{pis,name,registration,templates}]`. E o HMM-03, o "atrasado", foi **origem de 232
delas**. Dos servidores presentes em mais de um relógio, **nenhum** tinha digital num e não no
outro, nos dois sentidos.

## Comparar por `servidor_id` superestima a diferença

A primeira medição deu "3 pessoas só no HMM-01/02 e 130 só no HMM-03". Estava errada, e o motivo é
o **duplo vínculo**: ELZENIR COSTA SOUSA (mat 1013 × 68151) e PAULINO SANTOS VIEIRA (65562 × 67469)
têm dois cadastros no SisEscala com **o mesmo CPF e o mesmo PIS**. A mesma pessoa, o mesmo
`identificador_afd` no equipamento, contada como "só no A" por uma matrícula e "só no B" pela outra.

Comparando **por pessoa (CPF)**, a diferença real é **1 × 128**.

O usuário levantou o risco de duplicidade por CPF/PIS antes de qualquer operação, e ele existe de
verdade — mas as defesas seguraram. Estado medido: **zero duplicatas internas** nos três relógios,
e `rep_usuarios_dispositivo` com **`servidor_id` resolvido em 100%** dos 349 + 349 + 476 cadastros.
No mesmo dia, EUDES MIGUEL (mat 54364) — a única pessoa realmente ausente do HMM-03 — teve o
cadastro **recusado pelo equipamento** com `Matrícula já cadastrada`, que é o modo de falha
desejado.

## Por que NÃO mandar os cadastros do HMM-03 para o 01 e 02

A pergunta natural foi: *"por que não manda os cadastros do 3 pro 1 e 2, aí fica tudo igual?"*.
Medido, os 128 exclusivos do HMM-03 se dividem assim — e **nenhum** é lotado em setor que os
relógios do prédio principal atendem:

| quem são | quantos | por que copiar não resolve |
|---|---|---|
| de outras 13 unidades (HMI 23, SMS 14, CEI 5…) | 58 | bagagem do relógio reaproveitado — sai por higiene |
| lotados em setores do **CCE** | 35 | outro prédio |
| do HMM em setor sem relógio vinculado | 35 | ver a seção seguinte: o caminho é diferente em cada grupo |

Copiar espalharia **93 cadastros de fora do escopo** por mais dois equipamentos — e pela resolução
por CPF/PIS, quem está cadastrado e encosta o dedo **ganha ponto ali**. A contagem do relógio
reaproveitado deveria cair para perto da dos outros, nunca o contrário.

## A recomendação errada, e o que a corrigiu

A primeira resposta a "e os 35 em setor sem relógio?" foi **"vincule esses setores"**. Estava
errada, e só a hierarquia mostrou isso:

| setor (caminho completo) | lotados | decisão |
|---|---|---|
| `ALA - PSICOSSOCIAL` (raiz + 6 ramos) | **28** | **não vincular** — terceiro sítio físico, aguarda relógio próprio |
| `CSST` (raiz solta) | 5 | duplicata: existe `CORPO CLÍNICO \ CSST` já vinculado e com 0 lotados |
| `SAME \ APOIO` | 2 | **vincular aos três** — pai e irmãos já estão lá |
| `CCE \ MÉDICOS ESPECIALISTAS` | 1 | **vincular ao CCE-01** |
| 5 setores inativos | 0 | ignorar |

`PORTARIA`, `ADMINISTRATIVO`, `ASG` e `SUPERIOR` — os nomes que sugeriam "prédio principal" — são
todos ramos da ALA. No HMM **37 nomes de setor se repetem** sob pais diferentes. Vincular pela
folha do nome teria posto 28 pessoas de outro endereço nos relógios do prédio principal: exatamente
o erro que o HMM-03 cometeu com o CCE no dia anterior.

O sinal barato que separou os casos foi **batida real dos últimos 60 dias**: nenhuma das 28 pessoas
da ALA bateu em relógio nenhum, coerente com "o equipamento delas ainda não existe".

## O administrador não podia ter vindo junto

Nenhum caminho do SisEscala promove alguém a administrador do equipamento:

| caminho | payload |
|---|---|
| cópia de biometria (`rep.GravarTemplates`) | `{name, pis, registration, templates}` — **sem campo `admin`** |
| criação de cadastro (`add_users.fcgi`) | `"admin": false`, literal |
| CSV do pendrive (`cadastros-exportar`) | coluna `administrador` sempre `0` |

`rep.UsuarioDispositivo` **nem lê** o flag de admin da origem. Administrador se define na interface
do próprio equipamento, à mão.

E há uma segunda razão, independente: **o administrador do parque não está em nenhum relógio do
HMM.** Ele está em 13 dos 30 ativos, e a cópia de biometria **nunca cria usuário** — só grava
digital em quem já está no destino. Ele também não chega lá sozinho: as duas RPCs de enfileiramento
escolhem por lotação (ele é SMS / TI) ou por escala (não tem escala no HMM). Nos 12 relógios onde o
nome está gravado como `FERNANDO` (curto) o cadastro foi manual; só onde aparece o nome completo foi
o SisEscala que gravou.

✅ A exceção de ponto dele, essa sim, é automática e estava correta: **29 exceções para os 30
relógios ativos**, faltando só o dele (`Reg/TI/TFD`). O gatilho criou a do HMM-03 no dia em que o
equipamento nasceu.

## O que foi aplicado

`scratchpad/fix_vinculo_setores_hmm.mjs` (ensaio por padrão; grava só com `--aplicar`), com 8
pré-condições que abortam antes de escrever — entre elas *"o pai `SAME` está nos três e **não** está
no CCE-01"*, que é o que prova o sítio.

| relógio | setores antes | depois |
|---|---|---|
| HMM-01 · HMM-02 · HMM-03 | 173 | **174** (+ `SAME \ APOIO`) |
| CCE-01 | 10 | **11** (+ `CCE \ MÉDICOS ESPECIALISTAS`) |

Conferência depois de gravar: os quatro contadores subiram exatamente 1, `SAME \ APOIO` **não** foi
para o CCE-01, e a **sobreposição entre o prédio principal e o CCE-01 continua zero**.

Efeito medido 20 min depois, sem nenhuma ação a mais: REGIANI DA SILVA RODRIGUES (mat 8195) e
HILTON MOREIRA DA SILVA (mat 568) entraram em `rep_cadastros_fila` como `pendente` para HMM-01 e
HMM-02. As duas já têm digital no HMM-03, então a cópia automática completa o resto sem ninguém ir
ao equipamento.

## Continua em aberto

- **CSST**: qual dos dois é o real? Se for `CORPO CLÍNICO \ CSST`, o caminho é `fn_fundir_setor`,
  não vincular.
- **ALA - PSICOSSOCIAL**: 28 pessoas aguardando o relógio do sítio. Quando ele chegar, recebe os 6
  ramos — nunca "unidade inteira".
- `ALA - PSICOSSOCIAL \ ENFERMAGEM` está com o **setor inativo** e 1 servidor ativo lotado nele.
- As **6 pendências de biometria que envolvem o CCE-01** (2 para o HMM-03, 4 para o CCE-01) não são
  aplicáveis: máquinas diferentes, então viram `SemOrigemLocal` e não aparecem em tela nenhuma.
  É resolvido presencialmente ou pondo o CCE-01 na mesma máquina — e o usuário decidiu mantê-lo à
  parte.
- Os **58 cadastros de outras unidades** no HMM-03 só saem por higiene, hoje bloqueada para
  servidor `Ativo`.
