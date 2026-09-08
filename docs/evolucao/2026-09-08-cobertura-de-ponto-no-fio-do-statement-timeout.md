# A Cobertura de Ponto vivia a 1,4s do statement_timeout — e a tela pedia a mesma consulta duas vezes (08/09/2026)

## O relato

Perfil de RH abre `/marcacoes` → **Cobertura de Ponto** e recebe, em vermelho:

```
canceling statement due to statement timeout
```

e, logo abaixo, `Nenhum relógio de ponto no seu escopo.` Como Administrador Geral, a mesma tela
carrega normalmente.

## O que a segunda mensagem escondia

`Nenhum relógio de ponto no seu escopo` é **consequência** do erro, não um diagnóstico: a
consulta morreu, `listarCoberturaResumo` devolveu `{ dados: [], error }`, e a lista vazia
imprimiu a mensagem de escopo. O escopo do RH estava certo o tempo todo.

⚠️ **Estado de erro e estado vazio não podem se parecer.** Aqui os dois apareceram juntos, e a
mensagem de baixo aponta para a investigação errada (permissão, `profile_unidades`, papel) — que
foi exatamente por onde a investigação começou.

## O papel não era a causa

Medido em produção em 08/09/2026:

| perfil | o que enxerga |
|---|---|
| `super_admin` / `admin` | os 31 relógios (`fn_unidade_no_escopo` libera pelo ramo do papel) |
| **`rh` (RH Geral)** | os **mesmos 31** — os 8 perfis têm `acesso_todas_unidades = true` |
| `rh_unidade` | 3 (HMI) ou 5 (HMM) — **menos** trabalho, e justamente os relógios mais pesados |

Ou seja: **não existe caminho em que o RH pague mais caro que o Administrador Geral.** O que
existia era uma consulta cara para todo mundo, com quem passa passando por pouco.

## A medição

`statement_timeout` do papel `authenticated` = **8s**.

| medição (service_role, cache quente) | antes |
|---|---|
| `fn_cobertura_ponto_resumo` (31 relógios), 5 execuções | 4,6s · 4,7s · 5,3s · 5,4s · 5,7s |
| duas execuções **em paralelo** | 5,7s e 6,6s |
| `fn_cobertura_ponto_dispositivo` no REP-iDClass-HMM-04, cache frio | **8,0s — estourou** |

## Onde estava o custo

`fn_cobertura_ponto_dispositivo` materializa **uma linha por pessoa de cada relógio** — 615 no
HMM, 508 no HMI, ~5.200 pares (pessoa, relógio) no parque — e, para cada linha, faz quatro buscas
correlacionadas. **Nenhuma tinha índice pelo caminho que realmente usa:**

| busca da função | índice que existia |
|---|---|
| `rep_usuarios_dispositivo` por (dispositivo, **servidor**) | só `(dispositivo_id, identificador_afd)` |
| `rep_vinculos_servidor` por (dispositivo, **servidor**) | só por `identificador_afd` |
| `rep_cadastros_fila` por (dispositivo, servidor), **qualquer status** | só o parcial `WHERE status = 'pendente'` |
| `rep_afd_registros` por (dispositivo, identificador, data) | só `(identificador_afd) WHERE tipo_registro = '3'` |

Custo medido: **~1,1 ms por par (pessoa, relógio)**, quase todo aí — tabelas de 5 a 7 mil linhas
varridas inteiras uma vez **por pessoa**, e **3,17 milhões** de linhas em `rep_afd_registros`
filtradas por um índice que não conhece nem o dispositivo nem a data (a base tem AFD desde 2019,
então o índice antigo traz o histórico inteiro daquela pessoa em todos os relógios para só depois
descartar).

## E a tela pedia a mesma consulta duas vezes

`MarcacoesClient` dispara `listarCoberturaResumo()` no mount, para o badge da aba; `CoberturaTab`
dispara **a mesma consulta** quando a aba é aberta. Duas cópias de 5s competindo — e foi assim que
o print saiu: **o badge com `622` preenchido (uma cópia terminou) e a aba com o timeout** (a outra
não). Nada no código dizia que aquelas duas chamadas eram a mesma pergunta.

## Correção

**1. `20260908100000_indices_cobertura_ponto.sql`** — cinco índices, `IF NOT EXISTS`, **nenhuma
função tocada** (armadilha 1). Índice não muda semântica; reverter é `DROP INDEX`.

⚠️ O índice de `rep_afd_registros` é criado sobre 3,17M de linhas e pega `ACCESS EXCLUSIVE` por
alguns segundos (sem `CONCURRENTLY`, que não roda dentro de bloco de transação — e o editor SQL do
Studio abre um). Lote do coletor que caia na janela volta para a fila offline e é reenviado, sem
perda: o AFD permanece no equipamento.

⚠️ O índice antigo `idx_afd_identificador` **não foi substituído** — `fn_reparse_afd_dispositivo` e
as sondas de auditoria buscam por identificador **sem** dispositivo e continuam precisando dele.

**2. Tela** — `MarcacoesClient` passa o resumo já carregado para `CoberturaTab`
(`ResumoPrecarregado`), que **espera** por ele em vez de disparar a segunda cópia. Os dois pedem
mês/ano **explícitos e iguais**: sem isso o badge resolveria o mês corrente no fuso configurado
(dentro da RPC) e a aba no fuso do navegador, e nas últimas horas do último dia do mês pediriam
competências diferentes (armadilha 12).

## Depois de aplicar (medido em 08/09/2026)

| | antes | depois |
|---|---|---|
| resumo do parque, 5 execuções | 4,6s – 5,7s | **0,49s · 0,61s · 0,64s · 0,77s · 1,60s** |
| duas em paralelo (badge + aba) | 5,7s e 6,6s | **0,56s e 0,62s** |

**~9× mais rápido**, com margem confortável contra os 8s.

### Os números continuam os mesmos

Índice que muda resultado não é índice — então a conferência foi feita de três formas:

- **coerência interna**: nos 31 relógios, `ok + sem_vinculo + sem_biometria + fora_do_relogio +
  sem_cpf + sem_snapshot = total_pessoas`, e `nao_conseguem_bater = total_pessoas − ok`;
- **universo reconstruído por fora** (lotados ∪ escalados, respeitando os setores do dispositivo)
  para LACEM e CEI: **47 = 47 e 65 = 65, zero faltando, zero sobrando**;
- **`batidas_perdidas`** — justamente a subconsulta que o índice novo do AFD serve — conferida
  batida a batida na USF-DAA: 3 pessoas, 1 órfã cada, **as três batem** contra a contagem manual
  de AFD dos últimos 30 dias cruzada com a vigência do vínculo.

⚠️ **`total_pessoas` divergiu em 8 relógios entre a medição de antes e a de depois — e não é o
índice.** Foram **371 servidores criados nas últimas 24h** (2 nas últimas 2h): o HMI subiu de 508
para 509 nos **três** relógios ao mesmo tempo, que é a assinatura de uma pessoa nova lotada na
unidade, não de mudança de cálculo. A base está em carga de cadastro ativa — não compare medições
de horários diferentes como se fossem a mesma (o mesmo alerta já registrado em 05/09/2026).

ℹ️ Pela mesma razão, o badge da aba subiu de **622** (no print do relato) para **1.871** hoje: o
REP-iDClass-HMM-04 nasceu em 07/09 trazendo 620 pessoas no escopo (373 sem conseguir bater), e a
aba passou a listar lotados ∪ escalados desde 05/09. É crescimento de base, não de contagem.

## O que fica

- **Consulta que chama uma função por linha é O(linhas × custo da função)**, e o custo da função
  costuma ser dominado por buscas correlacionadas. `fn_cobertura_ponto_resumo` é um `LATERAL`
  sobre `fn_cobertura_ponto_dispositivo`: cada relógio novo (são 31, eram 6 em 19/08) e cada
  pessoa cadastrada empurram o total. **O parque cresce; a consulta não escala sozinha.**
- **Duas chamadas idênticas em paralelo não são metade do problema, são o dobro dele** — e a
  única pista disso na tela era um badge preenchido ao lado de um erro.
