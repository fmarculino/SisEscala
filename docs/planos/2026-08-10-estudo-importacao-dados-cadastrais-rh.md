# Importação dos Dados Cadastrais de RH (SFPRC01M) — estudo e plano

**Data:** 10/08/2026
**Arquivo:** [`docs/Dados Cadastrais - Julho 2026 - SFPRC01M.csv`](../Dados%20Cadastrais%20-%20Julho%202026%20-%20SFPRC01M.csv)
**Origem:** exportação do sistema de folha de pagamento da Prefeitura (relatório `SFPRC01M`), com o
cadastro da maioria dos servidores da SMS.
**Estado:** estudo concluído. Nenhuma migration, importação ou mudança de schema foi feita ainda —
este documento existe para alinhar as decisões antes de qualquer código.

---

## 1. O que é o arquivo, de fato

9.763 linhas, 45 colunas. **Cada linha é um vínculo empregatício, não uma pessoa.** A coluna
`Funcionario` é a matrícula do vínculo — quando alguém troca de cargo, é readmitido, ou renova um
contrato temporário, ganha uma matrícula nova e uma linha nova. A mesma pessoa (mesmo CPF) pode
aparecer várias vezes:

| medida | valor |
|---|---|
| linhas totais | 9.763 |
| CPFs distintos no arquivo inteiro | 6.526 |
| CPFs com **mais de 1 registro** | 1.611 (25%) |
| máximo de registros para o mesmo CPF | 13 |
| desses 1.611, quantos **mudaram de cargo** entre os registros | 853 |
| desses 1.611, quantos **mudaram de lotação** (ver § 3.3) entre os registros | 960 |

Ou seja: a repetição não é ruído de exportação nem duplicidade de cadastro — é o **histórico de
carreira** de cada pessoa (readmissões, renovação de contrato, mudança de cargo, mudança de
lotação), com uma linha por evento. Isso confirma exatamente o que você observou.

Por `Situacao`:

| valor | linhas | o que é |
|---|---|---|
| `Demitido` | 6.271 | vínculo encerrado — inclui gente que **ainda trabalha na SMS** sob outra matrícula (ver § 4) |
| `At. Normal` | 3.285 | vínculo ativo, situação normal |
| `Afastado` | 207 | vínculo ativo, servidor afastado (licença, etc.) |

**Vínculos correntes (o que interessa para importar agora): 3.492**, de **3.382 pessoas distintas**
por CPF.

---

## 2. Mapeamento coluna a coluna

| # | coluna do CSV | o que é | preenchida (ativos) | equivalente hoje no SisEscala | observação |
|---|---|---|---|---|---|
| 1 | `Funcionario` | matrícula do **vínculo** | 100% | `servidores.matricula` | muda quando o vínculo muda — ver § 5 |
| 2 | `Nome` | nome | 100% | `nome` | |
| 3 | `CodLotacao` | código do bloco de financiamento (18 valores) | 100% | **nada** | ver § 3.3 |
| 4 | `Lotacao` | nome do bloco de financiamento | 100% | **nada** | idem |
| 5 | `Cargo` | cargo, com código embutido (`"0101 TEC.ENFERM."`) | 100% | `cargos` (tabela já existe, 267 linhas) | ver § 3.1 |
| 6 | `Funcao` | função gratificada/comissionada | 1,6% (98,4% vazio) | **nada** | ver § 3.2 |
| 7 | `DataAdmissao` | admissão **deste vínculo** | 100% | `data_admissao_pmm` / `data_admissao_hmm` (existem, mas sem relação clara com vínculo) | |
| 8 | `Sexo` | | 100% | `sexo` | |
| 9 | `Situacao` | At. Normal / Afastado / Demitido | 100% | `status` (hoje só `Ativo`/`Inativo`) | ver § 3.4 |
| 10 | `Classificacao` | Contratado / Concursado / Comissionado | 99,8% | `vinculo` (Contratada/Concursada/Efetiva/Comissionada/Estagiária) | "Efetiva" e "Estagiária" não aparecem no CSV — ver § 8 |
| 11 | `DataDemissao` | só quando `Situacao = Demitido` | — | `motivo_inativacao` (sem data) | |
| 12 | `DataNascimento` | | 100% | `data_nascimento` | |
| 13–18 | `SalarioBase`…`ValorPrevidencia` | remuneração e previdência | 100% | **nada** | ver § 3.5 |
| 19 | `Telefone` | | **0%** | `telefone` | ver § 3.6 — não ajuda em nada |
| 20 | `Escolaridade` | | 29,8% | `escolaridade` | |
| 21 | `Nacionalidade` | | 100% (99,9% "Brasileira") | `nacionalidade` | |
| 22 | `EstadoCivil` | | 100%, mas com grafias duplicadas (`CASADA` × `Casado(a)`) | `estado_civil` | normalizar na importação |
| 23 | `Departamento` | **unidade física** (121 valores distintos) | 100% | `unidade_id` (só 16 cadastradas) | ver § 3.3 — é o que precisa de mais trabalho |
| 24 | `Dotacao` | dotação orçamentária | 100% mas **sempre `0`** | **nada** | ver § 3.7 — inútil nesta exportação |
| 25–27 | `Pai` / `Mae` / `Conjuge` | filiação e cônjuge | alto | `nome_pai` / `nome_mae` / `nome_conjuge` | |
| 28 | `CPF` | | 100%, mas só 70% com 11 dígitos | `cpf` | mesma armadilha do zero à esquerda — ver § 3.8 |
| 29 | `PIS_PASEP` | | **98,7%** | `pis_pasep` (hoje 0% preenchido no SisEscala) | ver § 3.9 — o maior ganho do arquivo |
| 30–31 | `Identidade` / `OrgaoExpedidor` | RG | 88% | `rg_numero` / `rg_orgao_emissor` | |
| 32 | `Titulo Eleitoral` | | 86% | **nada** | |
| 33–35 | `Endereco` / `Nro` / `Bairro` | | 100% | `endereco_logradouro` / `endereco_numero` / `bairro` | sem CEP na planilha |
| 36–45 | gratificações, auxílio transporte, 13º, descontos, horas extras | | alto | **nada** | ver § 3.5 |

Campos que o SisEscala **já coleta e o CSV não tem**: `registro_profissional`/`registro_profissional_orgao`
(CRM/COREN), dados bancários (`banco_nome`, `agencia_numero`, `conta_numero`, `chave_pix`), CEP.
Não há perda — só não há ganho por aqui.

---

## 3. Achados que mudam o desenho

### 3.1 Cargo já está em bom estado — mas com dois códigos por profissão

A tabela `cargos` já existe (267 linhas) e **93% dos 170 cargos distintos entre os vínculos ativos
batem por código** (`cargos.codigo` contra o prefixo numérico do `Cargo` do CSV). Isso não é
coincidência: 233 dessas 267 linhas foram criadas em **14/07/2026** — claramente um import anterior
de uma exportação parecida com esta.

Faltam **12 códigos**, mas dois deles são de alto volume:

| código | cargo | pessoas ativas |
|---|---|---|
| `0007` | AG.SERV.GER. | 435 |
| `0001` | AG.PORT. | 205 |
| `3369` | COORDENADOR III | 10 |
| `0010` | COORDENADOR I | 6 |
| (+ 8 outros, 1–2 pessoas cada) | | |

**Achado à parte, relevante para o seu comentário sobre cargos "não importados":** o mesmo cargo
existe **duas vezes** sob códigos diferentes dependendo do regime — ex.: `0101 TEC.ENFERM.`
(concursado) e `3716 TEC.ENFERM_CONTRATADO` (contratado) são a mesma profissão. Isso é o motivo de
muitos dos 253 cargos distintos no arquivo inteiro: não é que faltem cargos, é que **o cargo já
carrega o regime dentro do nome**. Vale decidir se o SisEscala replica essa duplicação (mais fiel à
fonte, zero tradução) ou normaliza (um cargo "Técnico de Enfermagem", regime fica só em
`vinculo`) — ver § 8.

### 3.2 Função ≠ Cargo, e hoje não existe campo para ela

`Funcao` está preenchida em só 56 de 3.492 vínculos ativos (1,6%) — e só para quem exerce cargo
comissionado/gratificado (coordenador, diretor, gerente). É uma **segunda posição**, sobreposta ao
cargo efetivo — no cadastro atual isso simplesmente não existe: o SisEscala tem um `cargo` (texto)
por servidor, ponto. Não há hoje onde guardar "é Técnico de Enfermagem efetivo *e também* Coordenador
de Laboratório".

### 3.3 `Lotação`/`CodLotacao` não é a unidade — é o bloco de financiamento do SUS

Este é o achado que muda a leitura de tudo. `CodLotacao` tem só **18 códigos** (1–14, mais 52–55
para setores do HMM), e os nomes batem exatamente com os **blocos de custeio do SUS** (Portaria de
Consolidação nº 6/2017): PAB, SIH (internação hospitalar), MAC/VISA, PACS, PSF, SAMU, CEREST,
Vigilância em Saúde, PNAISP, cedidos a outros órgãos. Isso é **de onde vem o dinheiro que paga a
pessoa**, não onde ela trabalha.

Acho que é isto que você chamou de "situação da lotação, com um código" — se for, a leitura acima
é o que encontrei; vale confirmar antes de desenhar a tabela (§ 8).

**Quem de fato indica onde a pessoa trabalha é `Departamento`** (a coluna 23): 121 valores
distintos entre os vínculos ativos, e batendo com nome de unidade física de verdade — `HOSPITAL
MUNICIPAL`, `CS PEDRO CAVALCANTE`, `CS ENF. ZEZINHA`, `SAMU`, `CRISMU`, etc. O SisEscala hoje tem
**16 unidades cadastradas**. A diferença não é só volume: tem entradas de manutenção óbvia
(`Atualizar`, 26 ocorrências — placeholder de dado incompleto na fonte) e gente **cedida a outros
órgãos** (Câmara Municipal, Fórum, Justiça Federal, escolas da SEMED, APAE) que formalmente é
"lotação SMS" mas não deveria virar unidade dentro do módulo de escala/ponto da saúde.

### 3.4 Situação: hoje é binária, a fonte tem mais estados e ainda faltaria "Falecido"

`servidores.status` no SisEscala só assume `'Ativo'` hoje (as 191 linhas de produção são todas
`Ativo`; `motivo_inativacao` existe na tabela mas nunca foi usado). O CSV distingue `At. Normal` /
`Afastado` / `Demitido` — mas **nem essa fonte tem "Falecido"** como valor próprio (óbito
provavelmente cai em `Demitido` com algum motivo em outro relatório que não este). Se "Falecido"
importa para o SisEscala, é uma categoria que **este arquivo não resolve sozinho** — precisa de
decisão e, possivelmente, de outra fonte ou de marcação manual.

### 3.5 Remunerações: ricas, e servem para guardar, não para operar

18 colunas de valores (salário base/bruto, descontos, líquido, previdência, gratificações,
auxílio-transporte, 13º, horas extras). Hoje o SisEscala não opera folha de pagamento — e não deveria
passar a operar por causa desta importação: quem é dono da folha de pagamento oficial é o sistema
de origem deste relatório, não o SisEscala. O uso correto aqui é **snapshot histórico** (registrar
o que a exportação de julho/2026 trazia, com data), não como fonte viva que o SisEscala mantém
atualizada.

### 3.6 Telefone: zero. Isto não resolve o problema que resolveria

**0 de 3.492 vínculos ativos têm telefone preenchido nesta exportação.** O SisEscala depende de
telefone para PIN por WhatsApp, aviso de ponto e acionamento de sobreaviso (v1.28–v1.34). Ou seja:
a importação **não** dá telefone de graça — quem não estiver hoje no SisEscala vai entrar sem
telefone, e a coleta continua sendo um trabalho à parte (o próprio fluxo de "completar cadastro
pendente" do § 6 é o lugar natural para isso).

### 3.7 Dotação orçamentária — pesquisado, e não dá para popular a partir deste arquivo

Você pediu para eu entender o conceito. Dotação orçamentária, pela Lei 4.320/1964 e pelo MCASP
(Manual de Contabilidade Aplicada ao Setor Público), é o código completo que autoriza uma despesa
no orçamento: **classificação institucional** (órgão + unidade orçamentária) + **classificação
funcional** (função + subfunção) + **programa/ação** + **natureza da despesa** (categoria
econômica + grupo de despesa + elemento) + **fonte de recursos**. Para folha de pessoal, o grupo
de despesa típico é "1 — Pessoal e Encargos Sociais", com elemento diferente para efetivo
(`11 — Vencimentos e Vantagens Fixas`) e para contratado por tempo determinado (`04`). Fica
definida anualmente na LOA (Lei Orçamentária Anual) daquele exercício.

**Neste arquivo, a coluna `Dotacao` vem 100% zerada** — não foi exportada de verdade. O que se
aproxima de "de onde vem o dinheiro" nesta planilha é o par `CodLotacao`/`Lotacao` (§ 3.3), que é
o bloco de financiamento do SUS, **não** a dotação orçamentária completa (que teria o código do
órgão/unidade orçamentária e o elemento de despesa). São conceitos relacionados mas não
intercambiáveis. Se a dotação de verdade importar para o SisEscala no futuro, precisa vir de outro
relatório do sistema de origem (provavelmente do módulo de execução orçamentária, não do módulo
de RH).

*Fontes: [MCASP — Classificações da Despesa Orçamentária](https://contas.cnt.br/mcasp/4-2-classificacoes-da-despesa-orcamentaria/);
[Despesa Orçamentária: conceitos, codificação e classificação (USP)](https://uspdigital.usp.br/portaltransparencia/arquivos/GlossarioFinanceiro.pdf);
[Manual Técnico de Orçamento](http://www.orcamentofederal.gov.br/informacoes-orcamentarias/manual-tecnico/mto_2016_2aedicao_220915.pdf).*

### 3.8 CPF: mesma armadilha do zero à esquerda (armadilha 10 do CLAUDE.md)

Só 2.439 dos 3.492 CPFs de vínculos ativos (70%) têm exatamente 11 dígitos. O resto perdeu dígitos
à esquerda na exportação (816 com 10 dígitos, e uma cauda com 6–9). **Mesmo mecanismo já documentado
no CLAUDE.md** para o AFD do relógio de ponto: reconstituir com `padStart(11, '0')`, nunca confiar
no comprimento bruto da string.

### 3.9 PIS/PASEP: 98,7% preenchido — o maior ganho concreto do arquivo

Hoje `servidores.pis_pasep` está **0% preenchido** em produção, e o CLAUDE.md já registra que é o
campo que o auditor fiscal usa para casar registros com o AFD (Fase 9 do módulo REP). Este arquivo
resolve isso de uma vez para praticamente toda a base — de longe o ganho mais direto da importação,
maior até que o cadastro de gente nova.

### 3.10 Vínculo simultâneo (o cenário que você descreveu: enfermeiro num turno, médico noutro)

**110 CPFs têm 2+ vínculos ATIVOS ao mesmo tempo** — matrícula, cargo e (às vezes) lotação
diferentes, mesma pessoa. Exemplos reais medidos:

```
ALEX JUNIOR CARVALHO COVRE
  54507  3680 TEC. EM ENFERM. SEG. NO TRABALHO   | CEREST/RENAST-SAUDE
  69247  3716 TEC.ENFERM_CONTRATADO              | SAUDE FIM-SIH - HMI

BEATRIZ BARCELOS SABINO
  68041  3718 ENFERMEIRO(A)_CONTRATADO           | SAUDE FIM-PAB
  53617  0101 TEC.ENFERM.                        | SAUDE FIM-SIH - HMM
```

(Duas linhas do CSV são duplicata exata — mesma matrícula repetida — e não vínculo real; a
importação precisa dedupe por `(matrícula, todos os campos)` antes de contar isso como duplo
vínculo.)

### 3.11 Sucessão de vínculo ao longo do tempo (o que você apontou agora há pouco)

Além do vínculo simultâneo, há o caso temporal: **598 CPFs têm 1 vínculo ativo hoje + histórico de
vínculo(s) encerrado(s)** — matrícula antiga aparece como `Demitido`, matrícula nova como
`At. Normal`. Isso cobre tanto renovação simples de contrato temporário quanto mudança real de
cargo/lotação — medido: **853 dos 1.611 CPFs com múltiplos registros mudaram de cargo entre eles, e
960 mudaram de lotação**. Não é ruído, é histórico de carreira genuíno na maioria dos casos.

O SisEscala já tem `historico_transferencias` (desde `20260612100000`), mas ela só registra
mudança de **unidade/setor** — não cobre cargo, função, matrícula nem `vinculo` (classificação).
Uma importação que só atualiza a linha atual de `servidores` **perde este histórico** se não for
desenhada para capturá-lo.

---

## 4. A cobertura de hoje é pequena — e é isso que justifica o projeto

| | |
|---|---|
| Servidores em produção no SisEscala | 191 |
| … com CPF preenchido | 134 (70%) |
| … desses, quantos aparecem como vínculo ativo no CSV | 123 (92%) |
| Pessoas distintas com vínculo ativo no CSV (toda a SMS) | 3.382 |
| **CPFs do CSV que NÃO estão no SisEscala hoje** | **3.259 (96%)** |

O SisEscala cobre hoje cerca de **5,6%** da força de trabalho ativa da SMS que aparece nesta
exportação. É o tamanho real da oportunidade — e também do trabalho de completar cadastro que vem
depois da importação automática.

(11 CPFs que estão no SisEscala não aparecem como ativos no CSV — provavelmente desligados depois
de julho/2026, ou CPF divergente por erro de digitação. Vale conferir um a um antes de qualquer
ação automática sobre eles; não são o foco deste plano.)

---

## 5. A decisão central: como modelar "pessoa" quando ela pode ter mais de um vínculo

Hoje o SisEscala não distingue **pessoa** de **vínculo**: uma linha em `servidores` é as duas
coisas ao mesmo tempo, e o índice único de CPF (`20260809110000`) foi desenhado exatamente para
impedir que a mesma pessoa tenha duas linhas — porque até aqui, toda ocorrência de CPF repetido
encontrada era erro de cadastro (o caso da VIVIAN, documentado em
[`2026-08-09-cadastro-unico-de-servidor.md`](2026-08-09-cadastro-unico-de-servidor.md)).

Este arquivo mostra que **CPF repetido também é um caso legítimo**: 110 pessoas com dois vínculos
simultâneos de verdade. O índice único atual **bloquearia a importação** desses casos se cada
vínculo virasse uma linha de `servidores` — e é exatamente o comportamento certo hoje, porque hoje
não existe vínculo duplo de verdade na base (a única duplicata real já foi resolvida). Ele vai
precisar mudar para a importação funcionar.

Duas formas de resolver, com trade-offs bem diferentes:

### Opção A — separar Pessoa de Vínculo (refatoração maior)

`servidores` vira a **pessoa** (CPF, nome, dados pessoais — uma linha por CPF). Um novo
`vinculos_servidor` (1:N) guarda cada matrícula com seu cargo, função, unidade, setor, classificação,
datas de início/fim — histórico incluído por natureza, sem tabela extra. Escala e ponto passam a
ser por **vínculo**, não por pessoa (é literalmente o cenário que você descreveu: a mesma pessoa
pode estar em duas escalas distintas, uma por vínculo).

- ✅ Modelo correto para o problema — resolve vínculo simultâneo, sucessão histórica e "duas
  matrículas, duas escalas" de uma vez, sem gambiarra.
- ❌ `escala_diaria`, `escala_mensal`, `marcacoes_ponto`, `folha_ponto`, o terminal `/presenca`, o
  portal do servidor — praticamente todo o sistema hoje assume `servidor_id` como a unidade de
  agendamento. Trocar essa referência para `vinculo_id` é uma migração de dados e de código em
  cascata, não uma tabela nova isolada. **Não é o tipo de mudança que se faz "de passagem" numa
  importação** — é um projeto próprio.

### Opção B — manter 1 linha = 1 vínculo, relaxar a unicidade de CPF com uma amarração

`servidores` continua como está (1 linha por matrícula/vínculo — o modelo atual). O índice único
de CPF deixa de ser absoluto: duas linhas podem compartilhar CPF **desde que estejam amarradas**
por um campo novo (ex.: `pessoa_ref_id` apontando para si mesma ou para a linha "principal"), e a
heurística de duplicidade (`fn_possiveis_duplicidades_servidor`) passa a **não** sinalizar esse
par como suspeito.

- ✅ Não toca em escala, ponto, folha, terminal nem portal — o resto do sistema nem percebe.
  Cabe dentro do escopo de uma importação.
- ❌ Não resolve o histórico temporal (§ 3.11) da mesma forma — sucessão de matrícula continua
  precisando de uma tabela de histórico à parte (nos moldes de `historico_transferencias`, mas
  cobrindo cargo/função/vínculo além de unidade/setor). E a distinção entre "vínculo duplo
  legítimo" e "erro de cadastro" (o problema que o índice único resolvia) passa a depender dessa
  amarração estar sempre correta na importação — se errar, volta o risco que motivou o índice em
  primeiro lugar.

**Minha recomendação é a Opção B para agora**, com o histórico de cargo/vínculo/lotação sendo uma
tabela de log (é o mesmo padrão já usado em `historico_transferencias` e em
`logs_preferencia_aviso_ponto` — append-only, sem reescrever o presente). A Opção A é
provavelmente o modelo certo *a longo prazo*, mas é grande demais para entrar como efeito colateral
de "importar um CSV" — se for para esse caminho, merece um plano próprio, focado só nela, depois
que a base estiver importada e o problema estiver medido com gente de verdade (não só nesta
planilha).

**Isto é uma decisão sua, não uma que eu deva tomar sozinho** — muda o desenho de tudo daqui para
frente.

---

## 6. Plano de importação proposto (independente da decisão da § 5)

1. **Tabela de staging**, ex. `importacao_rh_stg`: recebe o CSV quase cru (uma linha por vínculo,
   `Situacao IN ('At. Normal','Afastado')` — os 3.492 vínculos ativos), com CPF já normalizado
   (`padStart(11,'0')`) e datas convertidas.

2. **Casamento automático por CPF** contra `servidores.cpf`:
   - **CPF já existe no SisEscala** → candidato a **atualização** (preencher os campos que hoje
     estão vazios — PIS/PASEP é o caso mais valioso — e sinalizar divergência quando o que já está
     cadastrado não bate com o CSV, para decisão humana, nunca sobrescrita automática de dado que
     já existia).
   - **CPF não existe** → candidato a **cadastro novo**, mas fica **pendente de validação**, não
     entra direto em `servidores`. Precisa de:
     - **unidade resolvida** (fuzzy match de `Departamento` contra as 16 unidades existentes; sem
       match, fica pendente de decisão — criar unidade nova ou mapear para uma existente);
     - **setor resolvido** (o CSV não tem setor — nível abaixo de unidade –, só departamento/unidade);
     - **cargo resolvido** (já em bom estado, § 3.1 — só os ~12 códigos faltantes bloqueiam);
     - **telefone** (o CSV não traz — fica pendente de coleta, § 3.6);
     - **vínculo simultâneo ou sucessão histórica**, se aplicável (§ 3.10, § 3.11) — decide-se
       conforme a opção escolhida na § 5.

3. **Fila de pendências de importação** — mesmo espírito da tela `/servidores/pendencias`
   (v1.39.0): uma lista do que falta decidir por pessoa, não um bloqueio silencioso. Fecha
   naturalmente com aquela tela ou com uma extensão dela.

4. **Dicionários novos antes de rodar a importação em definitivo**:
   - completar os ~12 cargos faltantes em `cargos` (§ 3.1);
   - nova tabela para o bloco de financiamento (`CodLotacao`/`Lotacao`, § 3.3), se a leitura do
     achado estiver certa e você confirmar que quer capturar isso;
   - mapeamento `Departamento → unidade_id`, com as ~105 unidades que faltam (121 distintas menos
     as 16 já cadastradas, descontando placeholders como `Atualizar` e lotações cedidas a outros
     órgãos que não deveriam virar unidade de saúde).

5. **Snapshot de remuneração** (§ 3.5) como tabela histórica à parte, com a data da exportação —
   não como campo vivo em `servidores`.

---

## 7. Fora de escopo agora, e por quê

- **Dotação orçamentária de verdade** — a coluna não traz dado nesta exportação (§ 3.7); não há o
  que importar.
- **SisEscala operar folha de pagamento** — as colunas de remuneração servem para guardar histórico,
  não para o sistema passar a calcular ou manter folha viva.
- **"Falecido" como situação** — nem a fonte tem essa categoria própria (§ 3.4); precisa de decisão
  e possivelmente de outra fonte.
- **Opção A da § 5** (separar pessoa de vínculo) — grande demais para entrar como efeito colateral
  desta importação; fica registrado como possível projeto futuro.

---

## 8. Decisões pendentes (suas)

1. **Confirmar a leitura da § 3.3** — `Lotação`/`CodLotacao` é bloco de financiamento do SUS, não
   unidade física. É isso que você chamou de "situação da lotação"? Se sim, vira uma tabela nova de
   18 valores; se você tinha algo diferente em mente, preciso saber o quê.
2. **Opção A × B da § 5** — como modelar vínculo simultâneo e sucessão histórica. Recomendo B para
   agora, A como projeto futuro separado.
3. **Cargo duplicado por regime** (§ 3.1) — replicar a duplicação da fonte (`TEC.ENFERM.` e
   `TEC.ENFERM_CONTRATADO` como dois cargos) ou normalizar (um cargo, regime só em `vinculo`)?
4. **Departamentos cedidos a outros órgãos** (Câmara, Fórum, Justiça Federal, SEMED, APAE) — viram
   "unidade" no SisEscala (mesmo sem escala/ponto de saúde ali) ou ficam de fora do módulo de
   escala e só registrados como informação cadastral?
5. **"Efetiva" e "Estagiária"** (valores de `vinculo` que não aparecem no CSV) — servidores desses
   vínculos existem fora desta exportação? Se sim, esta importação não os alcança.
6. **Telefone dos novos cadastros** — fica pendente de coleta manual (coordenador preenche depois),
   ou existe outra fonte para casar?

Peço para você revisar as decisões acima antes de eu desenhar as migrations — principalmente a 1 e
a 2, que mudam o formato das tabelas novas.
