# O terminal local herdava o escopo do coordenador responsável (09/09/2026)

## O relato

Uma coordenadora abriu a validação manual do dia 8 e perguntou uma coisa simples:

> *"por que o sistema não está considerando essa batida como válida se está certinho o horário
> dentro da tolerância e na grade continua vermelho a marcação?"*

DEYLANE LIMA AZEVEDO MARTINS (mat. 67836), CAF POLO II - VELHA MARABÁ, jornada `08H ÀS 12H`. As
batidas eram `07:58:25` e `12:01:54` — dois minutos de cada ponta do previsto.

## Não era horário, e a própria tela dizia

O modal mostrava, embaixo das duas batidas:

> *"Recusadas pelo terminal: **Sem permissão para validar este servidor nesta unidade/setor.**"*

O terminal local **"POLO II - VELHA MARABÁ"** (unidade SMS, setor CAF \ POLO II) estava cadastrado
com **LUCILIA LIMA AZEVEDO** como coordenadora responsável — e a conta dela tem escopo só no
**HMI**. Toda batida daquele terminal era recusada, para todo mundo.

O caminho, em `20260827000000`:

```sql
-- fn_registrar_ponto_terminal_local
PERFORM set_config('sisescala.canal_ponto', 'terminal_local', true);
RETURN public.fn_registrar_ponto(p_matricula, p_pin_servidor, v_responsavel_id, NULL);
```

`v_responsavel_id` vira o `p_coordenador_id` de `fn_confirmar_presenca`, que aplica um **segundo**
guard: o do escopo do coordenador. E ele é do terminal **clássico**, onde o coordenador loga na
máquina e a sessão dele fica aberta na sala — ali o guard impede que alguém de outro setor use
aquela sessão. No terminal local não existe sessão de coordenador: o escopo real é o do
equipamento, conferido uma chamada antes, nas linhas que recusam a matrícula de outro setor
**antes mesmo do PIN**.

## Extensão

| dia | batidas recusadas |
|---|---|
| 02/09 | 3 |
| 03/09 | 20 |
| 04/09 | 20 |
| 08/09 | 16 |

**63 no total, 9 pessoas — 59 daquele terminal.** E os dias anteriores estão todos gravados com
origem `terminal` e horário real (ERICK 07:44→17:58, RODSON 08:20→17:59, GLEICIANE 07:54→18:00…):
alguém vinha validando as ~20 batidas à mão, **todo dia útil**. Trabalho recorrente causado por um
campo de cadastro.

⚠️ A batida nunca se perdeu — vira marcação pendente em `marcacoes_ponto`. Mas o servidor via
**"recusado"** na tela do terminal, e pela regra da cor (CLAUDE.md) isso ensina exatamente o
comportamento que a conformidade quer evitar. Era uma **quarta causa de recusa**, ao lado de
matrícula/PIN inválidos, que a v1.22.0 não previu.

## A correção — e o sinal que já existia

`20260909100000` pula o guard quando `sisescala.canal_ponto = 'terminal_local'`.

**Nenhum GUC novo foi criado.** Esse sinal já era publicado desde `20260827000000`, para o terminal
local não ser barrado pelo desligamento do terminal clássico — ninguém tinha percebido que ele
servia também para isto. Procurar o sinal existente antes de inventar um foi o que tornou a
correção uma função só, em vez de duas.

Gerada por `scratchpad/gen_terminal_local_escopo.js`, que copia **só** `fn_confirmar_presenca` de
`20260908140000` (a vigente) e aborta se a contagem de ocorrências divergir.

⚠️ **O bypass fica restrito a `= 'terminal_local'`.** Afrouxar a comparação mataria o guard de
escopo para o terminal clássico também — o gerador e a conferência da migration abortam se isso
acontecer.

Validada em homologação com cenário sintético revertido, **nos dois sentidos**:

```
A) terminal clássico → "Sem permissão para validar este servidor nesta unidade/setor."   guard preservado
B) terminal local    → "Sem escala agendada para hoje."                                   atravessou o guard
```

O sentido B parar em "sem escala" é o resultado certo: o servidor de teste não tinha escala, e o
que se queria provar é que o guard de escopo deixou de barrar.

ℹ️ Achado de passagem: `fn_terminal_classico_habilitado` **não** vive em `fn_confirmar_presenca`,
e sim em `fn_registrar_ponto`. São duas funções e dois guards distintos — conferir o guard errado
fez o portão de texto abortar por engano na primeira rodada.

## A segunda metade: por que o cadastro estava assim

A coordenadora levantou a hipótese certa por instinto, ainda que a mecânica fosse outra:

> *"a Lucilia tem dois vínculos e um deles é na CAF, e por algum motivo o sistema estava
> considerando só o vínculo que ela tem no HMI"*

O sistema **não escolheu** vínculo nenhum — ele nunca olha lotação para montar escopo de conta. O
escopo vem de `profile_unidades`/`profile_setores`, preenchidas à mão no formulário
(`formData.getAll('unidade_ids')`). Alguém marcou HMI + 3 setores do HMI, e SMS/CAF nunca foi
marcada. Os dois vínculos existem e estão certos no cadastro:

```
mat 67384   SMS / ADMINISTRAÇÃO \ CAF        (Contratada)
mat 10960   HMI / FARMÁCIA \ FARMACÊUTICOS   (Efetiva)
```

Pareceu escolha porque o escopo cadastrado coincide com o vínculo para o qual `profiles.servidor_id`
aponta (mat 10960). Coincidência de quem cadastrou — esse campo não influencia escopo; serve para
propagar e-mail e identificar o servidor logado (armadilha 17).

**O defeito real é que nada liga vínculo a escopo.** Quem tem dois vínculos tem **uma** conta
(`uq_profiles_servidor_id`), com escopo manual, e ninguém avisa que o segundo ficou de fora.

| | |
|---|---|
| CPFs com 2+ cadastros ativos | **19** |
| desses, com conta de usuário | **2** |
| em que o escopo não cobre um dos vínculos | **2** |

DENISVAL RODRIGUES (conta inativa) e a LUCILIA. Era o único caso vivo no parque.

### A correção é aviso, nunca automação

🚨 **Derivar escopo da lotação foi considerado e descartado.** Escopo é **autoridade**, lotação é
**onde a pessoa trabalha**, e as duas não coincidem por desenho: um coordenador pode ser lotado
num setor e coordenar outro; RH e admin têm escopo amplo sem lotação correspondente. Automatizar
daria acesso que ninguém autorizou — erro pior que o atual.

`src/utils/vinculosDoUsuario.ts` pinta em âmbar, na tela de Usuários, *"Esta pessoa também tem
vínculo em X, que não está no escopo desta conta"*. Quem decide continua sendo quem cadastra.

⚠️ **A busca dos vínculos adicionais não pode ser filtrada por unidade** — é o oposto do que a
lista de servidores faz para o `rh_unidade`. O vínculo que interessa é justamente o que está
**fora** do escopo do gestor; filtrá-lo junto faria o aviso nunca aparecer para quem mais precisa
dele.

⚠️ **Na dúvida, não acusa:** sem CPF não se afirma nada, vínculo sem unidade não conta, e setor
vinculado conta como alcance da unidade (o caso do coordenador cujo acesso vem só de
`profile_setores`). Conferido em produção: o aviso aparece nos **2** casos reais e em **nenhuma**
das outras 112 contas vinculadas.

ℹ️ Ao escrever o validador do portão, uma das regressões injetadas **não mudava o comportamento**:
"Acesso Total" é protegido duas vezes (o early-return e a checagem dentro de
`escopoAlcancaUnidade`), e derrubar só uma delas não altera o resultado. A injeção precisou
derrubar as duas. Injeção que não muda comportamento não testa nada — e duas outras foram
substituições no-op, porque as âncoras eram do TypeScript e o alvo é o **JS compilado** (o `tsc`
quebra `if (x) return []` em duas linhas). O validador detectou os três casos em vez de dizer
"passou", que é a armadilha 48.

## O que ficou para o operador

A troca do responsável para **MARIA WANDILA ALVES ARAUJO** (que cobre os 5 polos do CAF) foi feita
em 09/09 às 07:00:33 e resolveu na hora — a última recusa foi às 06:52, oito minutos antes.

Restaram os 5 pares de 08/09 (16 horários: ERICK, GLEICIANE e RODSON +4 cada; DEYLANE e
ELESSANDRA +2), recuperáveis por **Ferramentas → Preencher pelas Batidas**: conferidos par a par,
são só acréscimo, zero troca e zero perda. Dois dias de 02/09 não têm conserto automático (ERICK
sem batida aproveitável, RUTIANE só com a saída).
