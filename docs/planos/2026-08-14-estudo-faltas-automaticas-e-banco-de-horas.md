# Faltas automáticas e Banco de Horas vs. Jornada Diária — estudo

**Data:** 14/08/2026
**Origem:** observado na folha de ponto de CRISTIANO LIMA SALES (MOTORISTA, TRANSPORTE) — dias
12-14/08 sem nenhum registro de ponto e sem observação, não contados como falta em lugar nenhum.
**Estado:** falta automática (seção 2) **implementada em 14/08/2026** — regra com carência via
`justificativa_prazo_dias_uteis` (dias úteis após o fim do mês), sem alterar competência fechada,
nas 4 cópias de geração de folha + nos 3 lugares que recontam faltas a partir de `registros`
salvos. Banco de horas (seção 3) continua **só estudo** — nenhum código foi alterado, aguardando
você validar com jurídico/RH os pontos levantados ali antes de eu desenhar a arquitetura.

---

## 1. Duas perguntas, não uma

O pedido juntou dois problemas que são relacionados mas **independentes**:

1. **Falta automática** — hoje nada marca um dia útil sem batida como falta. É um gap concreto,
   pequeno de corrigir, e não depende do regime de ponto.
2. **Banco de horas vs. jornada diária** — hoje o sistema só entende um regime (comparação
   diária contra a jornada, com hora extra 50%/100%). Adaptar para banco de horas é estrutural,
   toca praticamente todo o módulo de folha de ponto, e tem implicações jurídicas que **não posso
   decidir sozinho**.

Trato os dois separados abaixo. O primeiro eu já sei como resolver. O segundo precisa das suas
respostas antes de eu desenhar qualquer coisa.

---

## 2. Falta automática — o que existe hoje e o que falta

### 2.1 Estado atual

`FALTA` só existe como **texto livre**. Em `folha-ponto/actions.ts` (as 4 cópias da geração de
folha, mesma armadilha de sempre):

```ts
if (registro.observacao.includes('FALTA')) {
  totalFaltas++
}
```

Ou seja: `total_faltas` só conta um dia se alguém **digitou** a palavra FALTA na observação —
manualmente, ou preservada de uma edição anterior (`shouldPreserve && registroExistente.observacao
.includes('FALTA')`). Não existe nenhuma lógica que, ao gerar a folha, olhe "dia útil, havia
escala, ninguém bateu ponto, não tem afastamento" e conclua "isso é falta". O dia fica em branco
(`--:--` em tudo), sem cor, sem contagem, sem sinalização nenhuma — foi exatamente o que você viu
no Cristiano.

Achei também que `justificativa_prazo_dias_uteis` (configurável em Configurações, "dias úteis após
o fim do mês" para justificar) **já existe na tela desde antes**, mas não é lido em lugar nenhum do
código — é um campo "de intenção" que nunca foi ligado a nada. Isso importa porque a pergunta
"falta até que alguém justifique" já tem um prazo pensado no sistema, só nunca foi usado.

### 2.2 Regra proposta (para sua validação, não implementada ainda)

Ao gerar/sincronizar a folha, um dia de trabalho vira **"Falta (pendente)"** quando, ao mesmo
tempo:

- havia turno Regular/Plantão previsto naquele dia (não é folga/domingo/sábado/feriado/ponto
  facultativo já coberto);
- não há afastamento cobrindo o dia (`servidores_eventos`);
- não há **nenhuma** marcação real nem validação manual em nenhum dos 4 passos (`origem_entrada`
  etc. todos vazios) — ou seja, é distinto de uma batida parcial (só entrada, por exemplo), que já
  tem tratamento próprio.

Duas decisões que preciso da sua confirmação:

1. **Existe estado intermediário, ou é falta desde o primeiro dia?** Minha leitura do seu pedido
   ("até que alguém justifique") é que sim — o dia nasce como pendência visível (ex.: observação
   automática "FALTA - AGUARDANDO JUSTIFICATIVA", cor de alerta), e vira falta **definitiva** só
   depois do prazo de `justificativa_prazo_dias_uteis` sem ninguém preencher uma observação/
   justificativa manual. Antes do prazo, conta como pendência em relatório, não decrementa como
   falta fechada. Faz sentido, ou você quer falta já contando desde o dia seguinte, sem prazo de
   carência?
2. **Isso roda em competência fechada?** Depois que o mês é encerrado (`competencias_encerradas`),
   os dados ficam congelados para auditoria — não dá pra continuar "promovendo" pendência a falta
   depois disso. A promoção pendência → falta definitiva só pode rodar **enquanto o mês está
   aberto** (ex.: num cron diário, ou ao entrar na tela). Um dia sem batida que já esteja num mês
   fechado fica como está hoje (branco), a menos que você queira uma correção retroativa
   caso a caso — mesmo princípio da correção que fizemos hoje para a Eva.

Essa parte eu considero pronta para implementar assim que você confirmar os dois pontos acima —
é local (as 4 cópias de geração de folha + talvez um cron para a promoção pendência→definitiva),
não exige mudança de schema além de, possivelmente, usar `justificativa_manual`/`observacao` que
já existem.

### 2.3 Implementado (14/08/2026)

Segui minha própria recomendação (com carência, sem tocar competência fechada), já que não houve
objeção. Fonte única em `src/utils/folha/faltaAutomatica.ts`
(`resolverFaltaAutomatica`/`isFaltaDefinitiva`/`diasUteisAposData`), usada em:

- as 4 cópias de geração de folha (`folha-ponto/actions.ts` × 2,
  `consultar-escala/actions.ts` × 2) — geram a observação (`FALTA` ou
  `FALTA - AGUARDANDO JUSTIFICATIVA`) quando o dia já passou, não tem afastamento/feriado/
  facultativo e não tem nenhuma marcação real nem manual;
- os 3 lugares que **recontam** faltas a partir de `registros` já salvos
  (`folha-ponto/actions.ts` `salvarFolhaPonto`, `consultar-escala/actions.ts` recompute de
  divergência, `FolhaPontoEditor.tsx` no cliente) — agora só contam `FALTA` definitiva,
  nunca a pendente.

`justificativa_prazo_dias_uteis` (configuracoes_globais) passou a ser lida pela primeira vez —
era um campo "de intenção" sem nenhum consumidor até aqui. Nunca sobrescreve uma observação já
preenchida (manual ou "FALTA" preservada de uma edição anterior).

Ainda não testado manualmente no navegador nesta sessão — próxima abertura da folha do Cristiano
(ou qualquer servidor com dia sem batida) deve mostrar a observação automática.

---

## 3. Banco de horas — o que descobri e por que não é pequeno

### 3.1 O que existe hoje é um regime só: jornada diária com hora extra

Todo o cálculo de horas na folha (`executeGerarFolhaPonto`/`sincronizarFolhaPonto`, as 4 cópias)
compara **dia a dia** contra a jornada do servidor:

- `totalHorasNormais` soma `horas_totais` da jornada por dia trabalhado — é fixo por dia, não
  depende de quanto a pessoa bateu de fato.
- Hora extra é **só** o que passa do horário oficial de saída daquele dia específico, dividida em
  50%/100% por domingo/feriado/noturno (`complianceEngine`-like, dentro do próprio action).
- Não existe nenhum conceito de "meta do mês" nem de saldo carregado de um mês pro outro.

`carga_horaria_semanal` (existe em `servidores`, default 40, editável no cadastro e na importação
CSV) **não é lida em nenhum cálculo hoje** — grep no repo inteiro não encontra uso fora do
CRUD/import do cadastro. É um campo dormente, exatamente como `justificativa_prazo_dias_uteis`.

Não existe **nada** de banco de horas na base: nenhuma tabela, coluna, função ou config com
"banco", "saldo" ou "compensat" no nome, em nenhum lugar do repositório.

### 3.2 O ponto que preciso que você confirme com o jurídico/RH antes de eu desenhar algo

Banco de horas na CLT (Art. 59 §2º e §5º) tem regras específicas — compensação em até 6 meses por
acordo individual escrito, ou até 12 meses por convenção/acordo coletivo, limite de 10h/dia, e
precisa de instrumento formal (a lei não deixa "empurrar hora extra pra depois" por decisão
unilateral do empregador).

**Mas nem todo vínculo na SMS é CLT.** O cadastro de servidores já tem `vinculo` com valores como
`Concursada`, `Efetiva`, `Comissionada`, `Contratada`, `Estagiária` (visto no estudo de importação
de 10/08/2026). Servidor **efetivo/concursado** de prefeitura normalmente é estatutário (Regime
Jurídico Único, regido por lei municipal própria, não pela CLT) — o regime de compensação de horas
dele pode ser **totalmente diferente** do CLT, ou nem existir formalmente. Só quem for
`Contratada`/CLT segue as regras acima ao pé da letra.

Isso significa que "aqui todo mundo trabalha em banco de horas" pode ser:

- (a) uma prática de gestão informal — a secretaria decidiu operar assim internamente,
  independente do regime jurídico de cada vínculo, sem instrumento formal por trás; ou
- (b) uma política com respaldo legal específico (lei municipal para estatutários + acordo/
  convenção para os CLT), com prazos e limites que **o sistema deveria travar**, do jeito que hoje
  trava intervalo intrajornada e interjornada.

A diferença importa demais pra eu simplesmente supor: se for (b), o sistema precisa recusar deixar
saldo de horas "vencer" sem sinalizar, e possivelmente diferenciar o prazo de compensação por
vínculo. Se for (a), é mais simples — um saldo corrente, sem prazo de expiração automática, com
decisão humana de quando descontar/compensar. **Preciso que você confirme isso antes da próxima
etapa.**

### 3.3 Pergunta prática que trava a conta, independente da resposta acima

"Carga horária de 40h semanais" vira quantas horas **no mês**? Não tem resposta única:

- `40 ÷ 5 dias úteis × dias úteis do mês` — mês com feriado no meio dá carga menor;
- `40 ÷ 7 × dias corridos do mês` — trata folga como parte do ciclo;
- carga fixa por convenção (ex.: sempre 176h/mês, 22 dias × 8h), ignorando quantos dias úteis o
  mês realmente teve;
- carga = soma das horas **da escala prevista** daquele servidor naquele mês (o que já está
  em `escala_diaria`/`jornadas`, dia a dia) — provavelmente a mais correta tecnicamente, porque
  plantonista de 12x36 não tem "40h semanais" fixas do mesmo jeito que um servidor de M-F 8h-17h.

Isso é decisão de RH, não técnica — e provavelmente **varia por tipo de jornada** (M-F fixo vs.
plantão 12x36 vs. carga semanal solta). Preciso saber qual fórmula usar antes de desenhar a
tabela de saldo.

### 3.4 Tamanho real da mudança, se avançarmos

Não é só "somar diferente no fim do mês". Toda a extensão que já existe hoje para hora extra
diária teria que **coexistir** com o cálculo de saldo mensal, porque:

- `complianceEngine.ts` calcula interjornada/DSR olhando turno a turno — continua valendo do
  mesmo jeito, banco de horas não muda limite de jornada nem descanso mínimo, só o que acontece
  com o excedente.
- As 4 cópias de geração de folha (`folha-ponto/actions.ts` × 2, e outras 2 fora dele, por
  `preAssinalacao.ts`) precisariam de um branch por regime — ou serem reescritas para delegar a
  um cálculo compartilhado por regime, o que seria a correção certa (unificar as 4 cópias numa
  função só, aproveitando a rodada).
- Relatórios que hoje mostram "horas extras do mês" (`relatorios/consolidado`,
  `relatorios/rh`, `relatorios/frequencia`) precisam de uma visão nova: saldo do banco, não só
  extra paga.
- Fechamento de competência (`autoClose.ts`, `isCompetencyClosed`) precisaria decidir o que
  acontece com o saldo ao fechar o mês: rola para o próximo, ou é liquidado (pago/descontado)?

### 3.5 O que NÃO estou fazendo agora

Não criei config nova, não mudei cálculo de hora extra, não toquei em `carga_horaria_semanal`.
Esperando suas respostas em 3.2 e 3.3 antes de propor arquitetura (provável: uma chave em
`configuracoes_globais`, tipo `regime_ponto: 'jornada_diaria' | 'banco_horas'`, granularidade a
definir — global, por unidade, ou por vínculo — mais uma tabela de saldo mensal por servidor).

---

## 4. Próximos passos

1. ~~Confirmar as duas perguntas da seção 2.2~~ — **feito, implementado em 14/08/2026** (§2.3).
   Falta testar na tela.
2. Banco de horas: você confirma com jurídico/RH a natureza do regime (§3.2) e a fórmula de
   carga mensal (§3.3) — só depois eu volto com uma proposta de arquitetura (schema + config +
   faseamento) para sua aprovação, do jeito que fizemos com o gate de Unidade da Folha de Ponto
   essa semana: plano primeiro, código depois de combinado.
