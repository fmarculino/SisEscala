# Painel de cobertura de escala do parque (06/09/2026)

## O que motivou

Servidor lotado no HMM que faz plantão no CCE ou no HMI precisa estar cadastrado **com digital**
no relógio daquela unidade para registrar ponto. A pergunta do usuário era se isso exigia
construir alguma coisa nova.

**Não exige.** A cadeia da identidade já é automática e já cobre o Servidor Externo:

| passo | peça | estado |
|---|---|---|
| coordenador escala o externo e **lança ao menos um dia** | `escala_diaria` | — |
| ele passa a constar no relógio do destino como `fora_do_relogio` | `fn_cobertura_ponto_dispositivo` (universo `lotados ∪ escalados`, filtrado pelo **setor da escala**) | já existe |
| o cron diário enfileira | `fn_enfileirar_cadastros_por_escala`, via `enfileirarCadastrosDoParque` | já existe |
| o coletor grava a identidade | ciclo, teto de 20/ciclo | já existe |
| **a digital** | — | **impossível automatizar** |

⚠️ **A biometria não atravessa unidade, e é estrutural.** `fn_biometria_faltante_dispositivo` só
busca origem em relógio da **mesma unidade**, e afrouxar isso não renderia nada: a cópia é feita
pelo coletor **dentro da rede da unidade**, e nenhuma máquina do parque atende duas unidades
(conferido em 06/09/2026, 29 dispositivos). Mandar o template pelo servidor está fora por LGPD e
por não haver rota de rede. **Quem trabalha em outra unidade cadastra a digital lá, uma vez.**

## O problema real: ninguém é avisado

A informação existe, mas só respondendo relógio a relógio, na aba Cobertura de Ponto. Não há lugar
que responda **"quem está escalado onde não consegue bater, e a partir de que dia"** — então o
coordenador do destino descobre quando a folha vem vazia.

Medido em 09/2026 (`scratchpad/an_proto_painel_cobertura.mjs`), 1.026 escalas com dia lançado:

| situação | escalas |
|---|---|
| ✅ consegue bater | 941 |
| 🔴 `sem_biometria` (está no relógio, sem digital) | 61 |
| 🔴 `sem_relogio_no_setor` | 17 |
| 🔴 `fora_do_relogio` | 5 |
| 🟡 `parcial` (bate em um relógio da unidade, não em todos) | 2 |

**85 escalas, 84 pessoas.** Só **2** são externos — o caso que motivou é real e vai crescer, mas
**restringir o painel a externos esconderia 82 dos 84**. Daí o escopo ser toda a escala.

**7 das 84 já batem em OUTRA unidade** — para essas falta só cadastrar a digital no destino, que é
exatamente a ação que o painel precisa provocar.

## O que construir

`fn_cobertura_escala_parque(mes, ano)` — uma linha por (servidor, escala) que **não** está `ok`,
com o primeiro dia escalado (urgência), se é externo, e onde a pessoa consegue bater hoje.
`fn_cobertura_escala_resumo(mes, ano)` agrega por unidade, no mesmo padrão de
`fn_cobertura_ponto_dispositivo` / `fn_cobertura_ponto_resumo`.

Nova aba **"Cobertura da Escala"** em `/marcacoes`.

### Decisões

| decisão | por quê |
|---|---|
| devolve **só o que não está ok** | 941 linhas `ok` não cabem em RPC sem paginação (armadilha 8) e não são o que a tela pergunta |
| universo = escala **com dia lançado** | quem foi adicionado à grade sem turno nenhum não trabalha ali; mandar ao relógio seria cadastro sem motivo. Foi o que separou os 4 "externos sumidos" de um bug real |
| `Sobreaviso` fora | não marca presença (armadilha 6) |
| a situação vem do **snapshot**, resolvido por `servidor_id` | recalcular `lpad(cpf,12,'0')` aqui duplicaria a regra de identidade e quebraria em relógio por PIS (armadilha 10) |
| **denylist** de papel, não allowlist | ver cobertura é visibilidade, não autoridade — a allowlist de `fn_pode_acionar_sobreaviso` deixou `rh` de fora por dois meses (armadilha 44) |
| escopo por `fn_unidade_no_escopo` **OR** `fn_unidade_alcancavel_por_setor` | a primeira sozinha ignora `profile_setores` e recusa coordenador legítimo |
| `REVOKE ... FROM PUBLIC` na mesma migration, com conferência que **aborta** | `CREATE FUNCTION` concede a PUBLIC (armadilha 24) |
| **não** enfileirar sozinho a partir daqui | painel é leitura; o cron e o botão já escrevem, e um caminho novo de escrita é risco sem ganho |

### Fora de escopo, deliberadamente

- **Aviso na grade ao escalar o externo.** Vale, mas mexe em `ScaleGrid.tsx` e no caminho de
  escrita da escala — some ao painel só depois que ele estiver em uso.
- **Cópia de biometria entre unidades.** Impossível pelo que está acima.
- **Trigger que enfileira ao salvar a escala.** Rodaria a cada célula; o cron diário mais o botão
  cobrem, e o ganho é de horas.

## Portão

`node scratchpad/an_proto_painel_cobertura.mjs` produz os números acima por fora, em JS. A
migration traz a consulta de conferência que precisa reproduzir **os mesmos** totais — se a função
e o protótipo divergirem, um dos dois está errado.
