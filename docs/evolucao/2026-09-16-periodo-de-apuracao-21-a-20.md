# Período de apuração 21 a 20: o regime, a montagem e o documento (16/09/2026)

**Versão:** v2.67.0 · **Migrations:** `20260916110000` e `20260916120000`, aplicadas e conferidas
em produção no mesmo dia.
**Plano:** [`../planos/2026-09-14-periodo-de-apuracao-da-folha-mais-medicos.md`](../planos/2026-09-14-periodo-de-apuracao-da-folha-mais-medicos.md)

## O pedido, e o que ele revelou

O Mais Médicos fecha a frequência no **dia 20**: o período vai de 21 de um mês a 20 do seguinte. A
folha do SisEscala é rigorosamente mensal, e não existia recorte que atravessasse a virada.

O plano de 14/09 assumiu que a exigência vinha do programa federal. **Não vem.** Ao ser perguntado,
o usuário esclareceu: *"essa é uma convenção que já vem de anos atrás, e a própria folha do
município já foi assim em algum momento"*. Isso mudou o desenho para melhor, em três pontos:

1. A Fase 3 (emitir/imprimir) ficou **desbloqueada** — não havia norma a esperar nem formato
   obrigatório do SGP a cumprir. O documento é da Secretaria.
2. 🚨 **O corte pode voltar a valer para a rede inteira** — já valeu. Então não bastava "4 linhas
   para 4 médicos": nasceu a **vigência global** (`servidor_id NULL`), que liga o corte para todos
   com **uma** linha, com vigência e histórico, em vez de 2.647.
3. A competência é **o mês em que o período FECHA** — *"esse mês que está sendo fechado agora dia
   20/09 é referente ao mês que está dentro, ou seja mês 09"*.

## 🚨 O achado que mudou a implementação: o período atravessa o corte de VIGÊNCIA

Isto não estava no plano e é a coisa mais importante do trabalho. As três chaves que regem o
cálculo do dia valem **desde 2026-09**: `horas_normais_liquidas_desde`,
`compensacao_atraso_vigente_desde` e `autorizacao_extra_vigente_desde`. O período 21/08→20/09 fica
com uma metade de cada lado do corte. Medido nas folhas reais dos 4 médicos:

| metade | horas normais por dia | regra |
|---|---|---|
| dias 21..31/**08** (folha `Revisada`) | **10,00 h** | vão bruto da jornada `08H ÀS 18H` |
| dias 1..20/**09** (folha `Rascunho`) | **7,58–7,60 h** | líquido, descontado o intervalo |

E **`totaisFolha(registros, opcoes)` recebe UMA competência e UMA carga por dia.** Chamá-la uma vez
sobre os 31 dias aplicaria a régua de setembro aos dias de agosto:

| servidor | pela folha | com régua única | diferença |
|---|---|---|---|
| T2600015 | 148h00 | 136h00 | −12h |
| T2600016 | 136h00 | 128h00 | −8h |
| T2600017 | 146h00 | 136h00 | −10h |
| T2600018 | 138h00 | 128h00 | −10h |
| | | | **−40h** |

Num documento que o servidor assina, e divergindo da folha de agosto, que está `Revisada`.
**A regra que saiu disso: `montarApuracao` chama `totaisFolha` uma vez POR METADE e soma.** A
apuração deriva da folha; nunca recalcula, nunca "uniformiza a régua".

⚠️ **Uniformizar parece mais coerente e é pior:** daria um documento internamente consistente cujo
número não existe em folha nenhuma. Duas réguas dentro do período é o que a realidade tem, porque a
regra mudou no meio — e a folha de cada lado está certa.

## As decisões de desenho que não podem ser desfeitas

### A montagem ficou em TypeScript, não numa RPC

O plano esboçava uma `fn_apuracao_periodo_servidor` que devolveria os totais. **Foi descartado**: os
totais dependem de `calcularDia`/`totaisFolha` — atraso, compensação (Art. 7º), autorização de
extra (Art. 8º), abono, falta. Reimplementar aquilo em SQL seria uma segunda opinião sobre a mesma
pergunta, que é o que produziu as 37 mil horas de divergência em 05/09/2026.

**O banco entrega as peças (janela, folhas, vigências); o TypeScript monta.**

E a confiança não veio de graça: `fn_emitir_apuracao` **confere o payload contra o banco** antes de
gravar — a janela vem do banco (nunca do payload), o número de dias tem de ser o do período, e
`dias_com_linha` é conferido contra `folha_ponto`. Documento que afirma 20 dias trabalhados onde a
folha tem 5 é recusado.

### O início é "fim do período anterior + 1 dia"

Nunca "dia_corte + 1 do mês anterior": com corte 28 em março, o mês anterior é fevereiro e o dia 29
não existe. Somando um dia ao fim anterior, a propriedade que importa sai de graça — **os períodos
consecutivos são contíguos e não se sobrepõem**, então nenhum dia de trabalho cai em dois
documentos nem em nenhum. O portão testa 5 anos × 4 regimes.

### O documento é snapshot, e a folha não é congelada

A tentação era travar os dias ≤ 20 assim que a apuração sai. Descartado: é a mesma armadilha de
preservar campo de origem `real` (19/08/2026) — congelar impede a folha de receber a correção de
uma batida mal alocada, que é a coisa que mais aparece nesta base.

O snapshot resolve sem congelar: reimprimir sai **do documento emitido**, e uma mudança posterior na
folha aparece como **divergência**, resolvida por **retificação** (versão nova, com motivo). É o que
a Portaria 4.198/2022 art. 101-B II descreve.

⚠️ **O fingerprint NÃO inclui o id da folha**, de propósito: sincronizar a folha sem alterar horário
nenhum não pode virar divergência, senão o aviso vira ruído e ninguém mais olha.

## Duas regressões escaparam do portão, e as duas eram defeito do portão

Vale guardar, porque é a armadilha 48/57 aparecendo de novo — e a primeira é sutil:

**"o fingerprint ignora os horários" passou.** O teste mudava um campo via `montarApuracao` e exigia
hash diferente. Só que mudar a entrada muda o **atraso**, que entra nos **totais**, que também estão
no hash: o hash mudava mesmo com o campo fora dele. O teste não isolava o que prometia. A correção
foi comparar dois documentos com **totais idênticos** que diferem só no campo — e hoje os 8 campos
do dia são testados um a um.

**"o fingerprint ignora a janela" escapou com razão.** Cada linha já carrega `d.data`, então
períodos diferentes têm dias diferentes e o hash muda de todo jeito: a janela no texto é redundante.
A injeção foi **removida** em vez de forçada — injeção que não muda comportamento observável é
injeção inútil, e fingir cobertura é pior que reconhecer a redundância.

## Achados menores, mas caros se esquecidos

- **`profiles` não tem coluna de e-mail.** Escrevi `COALESCE(p.full_name, p.email, ...)` e isso só
  estouraria na **execução** (armadilha 1). Conferido antes de aplicar: a tabela tem `full_name`,
  o e-mail vive em `auth.users`.
- **O laço da conferência usava variável `date` para receber inteiro** (`FOR v_ini IN
  generate_series(1,12)`). Também só estouraria na execução.
- **O script de medição mentia por um divisor.** A primeira versão comparava usando
  `diasComRegistro` (dias com **linha** na folha, 31) em vez de dias com **turno** (17), e anunciava
  100h de prejuízo onde eram 12h. Número errado em script de medição é o que produz relatório falso.
- **A verificação em produção NÃO testa o append-only, e é decisão registrada.** Testar por fora
  exigiria inserir uma linha que depois não sairia (o trigger recusa `DELETE`, e revogar exige
  papel): a sonda ficaria para sempre numa tabela de documento, indistinguível de emissão real. Quem
  garante o append-only é a conferência **dentro** da migration, que aborta e não deixa rastro.
- **A leitura na ficha e a tela toleram a ausência das tabelas** (`regimeDisponivel`/`disponivel`).
  Obrigatório: o deploy é automático a cada push e a migration é manual — sem o guard, a ficha de
  todo servidor quebraria na janela entre os dois. É andaime, e sai quando as duas estiverem
  aplicadas em toda parte.

## O que ficou medido, e o que ficou aberto

✅ **Nada mudou de valor em produção.** 0 linhas em `folha_regime_vigencias`, 0 em `folha_apuracoes`,
e os 2.647 ativos continuam no mês civil — conferido executando as funções
(`ver_regime_apuracao_producao.mjs` 26/26 e `ver_apuracao_producao.mjs` 20/20).

✅ **O caso de borda da lotação apareceu sozinho no dado real:** no período 21/08→20/09 os 4 médicos
mudam de `AMBULATÓRIO CLÍNICO` para `MAIS MEDICOS` (transferência de 09/09). As duas lotações vão no
documento, como o desenho exige — e isso não foi construído para o teste, foi encontrado.

⚠️ **Aberto:** atribuir o regime aos 4 médicos é ato de quem administra, pela ficha de cada um — as
RPCs exigem sessão, e `service_role` é recusado de propósito. E a **Fase 5** (devolver os 4 ao setor
real, agora que o regime não depende do setor) continua com medição própria.

⚠️ **O setor `MAIS MEDICOS` continua sem relógio vinculado**, e a v2.64.0 criou a tela que vai
sugerir vinculá-lo. No dia em que alguém vincular setores àquele relógio, os 4 saem da Cobertura de
Ponto em silêncio — é o ponto cego do HMM-03 esperando acontecer, e é mais uma razão para o regime
nunca ter morado no setor.
