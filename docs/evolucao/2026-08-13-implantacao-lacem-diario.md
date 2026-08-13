# Implantação do relógio no LACEM — diário de campo (13/08/2026)

**Versões ao fim do dia:** app `1.64.2` · coletor `0.4.4` · migration `20260813000000`

Primeira instalação real fora do piloto da TI, feita presencialmente no LACEM (Laboratório Central
de Marabá). Este arquivo é o fio condutor do dia; o detalhe técnico de cada parte está nos dois
documentos irmãos:

- [`2026-08-13-remocao-de-cadastro-no-relogio-lacem.md`](2026-08-13-remocao-de-cadastro-no-relogio-lacem.md) — `remove_users.fcgi`
- [`2026-08-13-cobertura-de-ponto.md`](2026-08-13-cobertura-de-ponto.md) — a tela de Cobertura da Escala

## O que aconteceu, em ordem

**1. A higiene do relógio falhou nas 31 remoções.** O equipamento vinha reaproveitado de outro
sistema, com 31 cadastros de gente fora do quadro. `remove_users.fcgi` recusou todas com
`'users' em formato incorreto` — o corpo `{"users":[{"pis":N}]}` era aproximação por simetria,
nunca confirmada contra hardware, e estava marcado como tal no código e no `CLAUDE.md`. Nada foi
perdido: a única chamada destrutiva da cadeia recusou.

**2. O formato certo foi descoberto e confirmado.** `{"users":[N]}` — array de **números** com o
`pis`. Validado criando e apagando o usuário descartável "SISESCALA TESTE - PODE APAGAR", com
relistagem provando que só ele saiu. Depois disso, as 31 remoções reais rodaram:
`31 removido(s), 0 nao efetivado(s)`.

**3. A pergunta que mudou o dia:** "todos os servidores do LACEM que estão nas escalas estão
efetivamente no ponto?". Resposta medida em produção, agosto/2026, **39 escalados**:

| situação | servidores |
|---|---|
| bate e não registra (sem vínculo) | **27** |
| fora do relógio | 10 |
| sem biometria | 1 |
| pronto para bater | **1** |

**4. Duas servidoras deram nome ao caso mais escondido.** Gabriela Santos Moreno e Izabella
Borges Carvalho estavam na escala, batendo ponto no terminal do computador todo dia, e nunca
tinham sido enviadas ao relógio — porque o botão "Sincronizar cadastros" escolhe por **lotação**,
e elas estão lotadas em outro lugar. O botão respondia "0 enfileirados" sem dizer que existiam.

**5. Virou tela.** Aba **Cobertura da Escala** em `/marcacoes`, com alerta no rótulo, seis
situações explicadas, e dois botões de conserto. Aplicada em produção no mesmo dia, reproduziu a
contagem manual exatamente (38 de 39) — o que fecha o portão de conferência da migration.

## O que ficou confirmado contra hardware real

| chamada | estado |
|---|---|
| `remove_users.fcgi` | ✅ **confirmada** — `{"users":[N]}`, com `pis` |
| `add_users.fcgi` / `load_users.fcgi` | ✅ já confirmadas em 12/08 |
| `get_afd.fcgi?mode=671` / `login.fcgi` | ✅ desde 08/08 |
| `get_system_information.fcgi` | ⚠️ segue aproximação |

## Erros que este dia produziu (e o que cada um ensinou)

- **Server Action que lança tem a mensagem apagada em produção.** A primeira falha da tela
  apareceu como "An error occurred in the Server Components render", sem causa. As actions de
  cobertura passaram a **devolver** o erro como dado. Valor devolvido não é redigido.
- **`CREATE OR REPLACE` não altera a lista de colunas de um `RETURNS TABLE`** (`42P13`).
  Migration que devolve `TABLE(...)` precisa de `DROP FUNCTION IF EXISTS` antes do `CREATE`, com
  os dependentes derrubados primeiro.
- **`configuracoes_globais` é chave/valor, com `valor` jsonb** — não existe coluna `timezone`. O
  `CLAUDE.md` afirmava o contrário e a nota foi corrigida. O erro só aparece em runtime, porque
  plpgsql não resolve nome de coluna na criação da função (armadilha 1, de novo).
- **Ação principal escondida atrás de um clique** faz a legenda mandar clicar num botão que
  ninguém acha. Os botões de conserto saíram do painel expansível para o cartão do relógio.

## Estado do LACEM ao fim do dia

Cadastro do equipamento **limpo** (31 removidos) e diagnóstico **completo e visível**. Os
consertos ainda **não foram aplicados** — nesta ordem:

1. **Criar vínculos por CPF** — resolve os 27 na hora, sem tocar no equipamento.
2. **Enfileirar cadastro(s)** para os 10 fora do relógio e rodar o coletor na máquina da unidade.
3. **Biometria da Gisele** — única que exige alguém presencialmente no equipamento.

Pendências conhecidas, todas registradas:

- **8 batidas perdidas em 30 dias** continuam órfãs. Recuperar exige `fn_reparse_afd_dispositivo`
  com data limitada — decisão à parte, porque mexe em ponto passado e o histórico do sistema
  anterior (~34.500 marcações) está no mesmo AFD.
- **A projeção para a folha segue desligada** (Fase 5): mesmo com vínculo, a batida vira marcação
  no módulo, não linha de folha.
- **`sync` reprocessa o AFD inteiro a cada 5 minutos** — medido aqui, com volume real. Candidato
  a prioridade (ler `ultimo_nsr` antes de pedir).
- **`coletor-rep higiene-remover` segue só na CLI**, mesmo com o formato confirmado: é a única
  operação que apaga cadastro de equipamento de produção.

## Regras novas que valem além do LACEM

- **Estar cadastrado no relógio não é estar no ponto.** Sem `rep_vinculos_servidor`, a batida é
  aceita pelo equipamento e morre órfã — silenciosa dos dois lados.
- **Enfileirar cadastro por lotação não cobre quem está escalado.** Por isso
  `fn_enfileirar_cadastros_por_escala` existe em paralelo à função da Fase 7.
- **`ok` do equipamento não é remoção.** Só relistagem confirma; sem isso a fila fecharia como
  aplicada dizendo que o relógio está limpo quando não está.
- **Um formato de API não confirmado não vira certeza por parecer simétrico.** A varredura de
  candidatos com conferência por relistagem fica no código justamente para o próximo modelo.
