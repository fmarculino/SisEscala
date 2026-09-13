# O terminal local não existia no painel de implantação (13/09/2026)

O painel público (`/implantacao`) media o avanço por **relógio de ponto** e por mais nada. O
usuário apontou o que estava faltando:

> notei que os terminais locais não estão sendo mostrados na página de implantação, apesar de não
> serem relógios físicos fazem parte da implantação sim (...) geralmente unidades pequenas com
> menos de 10 servidores provavelmente não terão relógios, serão colocados nos terminais.

## O que estava errado

A regra de fase era literal:

```ts
fase: temRelogio && temEscala ? 'operando' : temEscala ? 'preparando' : 'cadastrada'
```

`temRelogio` vinha só de `dispositivos_rep`. `terminais_locais` — a tabela que existe desde
11/08/2026 e que sustenta o terminal de presença sem sessão de coordenador — **não era consultada
em lugar nenhum daquele arquivo**.

Hoje isso não mudava número nenhum: os **2 terminais do parque** (POLO I - SHOPPING e POLO II -
VELHA MARABÁ) são os dois da SMS, que já tem relógios e já contava como operando. Por isso passou
despercebido.

🚨 **O dano é o da próxima unidade, não o de hoje.** No desenho que o usuário descreve, a unidade
pequena recebe **terminal e nunca vai receber relógio**. Com a regra antiga ela entraria em
operação de verdade — escala montada, servidor batendo ponto, marcação chegando em
`marcacoes_ponto` — e ficaria **para sempre** em "em preparação", num painel cujo público é a
diretoria e cuja leitura natural é atraso da implantação. É a armadilha 22 pelo avesso: não é
relatar o que se calculou como se fosse o que aconteceu, é **deixar de relatar o que aconteceu**
porque o modelo só sabia medir um dos dois caminhos.

## O que mudou

| onde | antes | agora |
|---|---|---|
| regra de fase | `relógio + escala` | **ponto de marcação** (relógio **ou** terminal) `+ escala` |
| KPI 2 | "Relógios ativos: 32" | "Pontos de marcação: 34" · sub `32 relógios · 2 terminais` |
| cartão da unidade | tag `N relógios` | ganha a tag `N terminais`, em rosa |
| pé do cartão | "Relógio ativado em …" | "Relógio" / "Terminal" / "Ponto de marcação", conforme o que a unidade tem |
| `ativadoEm` · `ultimoContato` | só relógios | primeira ativação e último contato de **qualquer** ponto |
| cronograma, marco 1 | "Primeiro relógio em operação" | rotulado pelo `tipo` da primeira ativação |
| legenda do avanço | `escala + relógio` | `escala + ponto de marcação`, com um parágrafo explicando |

⚠️ **O número grande do KPI é a soma, mas a linha de baixo separa os dois — e essa separação não
pode sair.** Terminal não é relógio: não tem AFD assinado, não entra em "Registros coletados", e
o regime legal dele é outro (o terminal é REP-P; o relógio é REP-C). Um rótulo único de "34
equipamentos" esconderia isso de quem lê o painel sem conhecer o sistema.

⚠️ **Terminal desativado não sustenta "operando".** `ativo = false` é a revogação de verdade nas
duas tabelas — em `terminais_locais` é o que derruba a sessão do navegador já aberta, na marcação
seguinte —, então o filtro é o mesmo que já valia para os relógios.

⚠️ **Relógios e terminais entram na MESMA lista de ativações, com `tipo`.** O primeiro marco do
cronograma lê a primeira linha dali e se rotula por ele. Hoje a primeira é um relógio
(08/08/2026) e o texto não muda; deixar o terminal de fora faria a página anunciar "primeiro
relógio em operação" no dia em que a primeira unidade a entrar tivesse só terminal.

## O que NÃO mudou

- **Nenhuma migration.** É mudança de leitura — `terminais_locais` já tinha tudo (`unidade_id`,
  `ativo`, `created_at`, `ultimo_contato_em`).
- **O gráfico de registros por mês** já separava "Relógio de ponto" e "Terminal" desde sempre. A
  série roxa daquele gráfico é a origem `terminal` de `marcacoes_ponto`, que cobre o terminal
  clássico e o local — e continua como estava.
- **"Registros coletados"** continua contando só AFD, com o rótulo que já dizia isso ("do
  arquivo-fonte assinado"). Unidade com terminal não gera AFD, e inflar esse número com
  marcação de terminal seria creditar ao artefato legal um registro que não é dele.
- **O manual do usuário** não descreve este painel (é página pública, fora do menu), então não
  houve o que atualizar ali.

## Medição

Não houve consulta a produção nesta sessão: os **2 terminais**, as unidades deles e o estado do
parque vieram das telas que o usuário anexou (aba Terminais Locais de `/marcacoes`, que lista o
parque inteiro para o Administrador Geral, e o próprio painel). Como os dois estão na SMS, que já
é `operando` pelos relógios, **a contagem de unidades operando não muda com esta alteração** —
ela muda a partir da primeira unidade que receber terminal sem relógio. Reconferir no painel
depois do deploy.

## Portão

`npx tsc --noEmit`, `npm run lint` e `npm run build` — os três limpos. Não há teste automatizado
aqui; o gerador que aplicou as substituições
(`scratchpad/gen_terminais_no_painel.js`) **aborta** se qualquer trecho não aparecer exatamente
uma vez, e trata o CRLF dos dois arquivos explicitamente (armadilhas 48 e 59: substituição com o
EOL errado vira no-op silencioso e o script "passa" sem ter trocado nada).
