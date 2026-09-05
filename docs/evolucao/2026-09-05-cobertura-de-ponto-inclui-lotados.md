# Cobertura de Ponto passa a listar lotados, e o envio ao relógio deixa de depender de clique (05/09/2026)

**Versão:** v2.41.0 · **Migration:** `20260905100000_cobertura_de_ponto_inclui_lotados.sql`

## Como começou: um log de relógio que parecia bug do sistema

O relato inicial era outro — o coletor da **USF José Manoel da Anunciação (Vila Brejo do Meio)**
enchendo o log de erro contra o relógio `192.168.0.200`:

```
context deadline exceeded (Client.Timeout exceeded while awaiting headers)
dial tcp 192.168.0.200:443: connectex: o componente conectado nao respondeu
```

Diagnóstico medido no local, com o relógio acessível pela rede:

| camada | resultado |
|---|---|
| ICMP, 120 pacotes | 117 ok, 3 perdidos (2%), picos de 884ms |
| TCP na 443, 60 tentativas | **60/60**, média 41ms |
| HTTP na porta 80 | responde em **14ms** (301 → força HTTPS) |
| **HTTPS, 1 conexão** | TCP 20ms, **TLS de 1,1s a 4,2s** |
| **HTTPS, 8 simultâneas** | TLS 1,4 → 2,7 → 4,2 → 5,4 → 8,3 → 9,2 → **16,3s**; a 8ª **falhou em 21s sem conectar** |

⚠️ **O gargalo é a negociação TLS do equipamento, não a rede.** O REP gasta ~1,1s de CPU por
handshake, **serializa** os handshakes e para de aceitar conexão por volta de 7–8 simultâneas. As
duas mensagens diferentes do log são o mesmo fenômeno em dois estágios: entrar na fila e não ser
atendido em 30s, e a fila cheia descartando o SYN (os 21s são a retransmissão do Windows).

⚠️ **A interface web do relógio aberta num navegador triplicava o custo** — com ela aberta o
handshake ia a 4,2s e ficava errático; fechada, estabilizou em ~1,1s. **Não deixar a interface web
do relógio aberta** é regra operacional, e é fácil de violar durante uma instalação.

🚨 **Mas ela não era a causa raiz.** Um monitor rodando de **outra máquina**, com **uma** requisição
a cada 29s, falhou na mesma janela das 11:55–11:59 — o equipamento ficou surdo na 443 por ~4
minutos, para todo mundo, com o navegador já fechado. Foi um evento único; não repetiu em ~25 min
de monitoramento nas três camadas (40 amostras limpas).

**Pendente:** separar "o relógio reinicia" de "só o servidor web dele trava". O teste que decide
não precisa de credencial: durante o travamento, **se o ping continuar respondendo**, o equipamento
está de pé e é firmware (chamado na Control iD); **se o ping cair junto**, é reinício
(fonte/hardware).

ℹ️ **A coleta de ponto nunca falhou.** Nenhum `sync` deu erro no log inteiro — o AFD estava em dia
no NSR 2078. Quem sofria era cadastro e higiene, que são auxiliares.

## O que apareceu no meio: "o SisEscala só mostra a Larissa"

A unidade tem **4 servidores lotados**, os 4 cadastrados no relógio **com biometria**, e alguns já
batendo ponto. A aba mostrava **1**.

✅ **Não era bug.** `fn_cobertura_ponto_dispositivo` montava a lista a partir de
`escala_mensal JOIN escala_diaria`: ela respondia *"dos ESCALADOS, quem consegue bater?"*. Só a
Larissa tinha escala em 09/2026. O log do próprio coletor provava que o SisEscala recebera os 4:

```
higiene: snapshot reportado — {"success":true,"total":4,"sem_correspondencia":0,...}
```

**Os dois números estavam certos. A tela é que respondia outra pergunta.**

## O que a medição revelou, e que era muito maior

Medido em produção em 05/09/2026 (com autorização), sobre os 29 dispositivos:

| situação dos lotados no parque | quantidade |
|---|---|
| cadastrados **com biometria** → conseguem bater | 2.100 |
| cadastrados **SEM biometria** → **não conseguem bater** | **1.257** |
| fora do relógio | 52 |
| falta enviar ao equipamento | **24** |

Piores casos: **HMM-01 e HMM-02 com 348 sem biometria cada** (1 pessoa com digital em 350),
**CAPS III 57** (nenhuma digital), **CCE-01 35** (nenhuma), **HMI ~82** em cada um dos 3 relógios.

⚠️ **O gargalo real não é o envio, é biometria presencial** — e ele estava invisível para quem não
está escalado.

⚠️ **O número de escalados varia de 640 a 1.785 conforme o mês** (a implantação da escala está em
andamento: HMI tinha 6 escalados em 08/2026 e 390 em 09/2026). A união fica **estável em ~3,4 mil**
nos dois meses. É isso que faz a aba parar de depender de a escala ter sido lançada.

## A mudança

### 1. `fn_cobertura_ponto_dispositivo`: universo = lotados **∪** escalados

⚠️ **União, nunca substituição.** Trocar escala por lotação quebraria o **"Servidor Externo"**
(v1.2.4) — escalado aqui, lotado em outra unidade. Conferido depois de aplicar: **22 externos
preservados**. É a mesma convivência que `fn_enfileirar_cadastros_rep` (lotação) e
`fn_enfileirar_cadastros_por_escala` (escala) já tinham.

⚠️ **`dias_com_escala = 0` identifica quem entrou por lotação**, sem coluna nova: a CTE de
escalados agrupa sobre `escala_diaria`, então quem tem escala tem sempre ≥ 1 dia.

⚠️ **`escalados` no resumo NÃO mudou de significado** — continua contando só quem tem escala. O
denominador novo é **`total_pessoas`**, somado ao lado. Mudar um número que já está na tela é pior
que acrescentar um número novo (mesma regra de `cobertos_em_outro`, 25/08/2026).

🚨 **Recriar função cria objeto NOVO, e objeto novo nasce com `EXECUTE` para `PUBLIC`**
(armadilha 24). A `20260830120000` havia revogado `anon` **destas duas exatas funções**; sem o
`REVOKE` a migration as reabriria em silêncio. Ela confere o próprio resultado com
`has_function_privilege` **nos dois sentidos** e aborta.

ℹ️ De passagem, `count(*)` virou `count(c.servidor_id)` no resumo: com `LEFT JOIN LATERAL`, um
dispositivo sem ninguém contava a linha sintética e devolvia 1 onde o certo é 0.

### 2. Envio automático ao ponto

🚨 **O enfileiramento era 100% manual.** `fn_enfileirar_cadastros_rep` e
`fn_enfileirar_cadastros_por_escala` só rodavam no clique de "Sincronizar cadastros" — **não havia
trigger nem cron**. Servidor novo com lotação definida **nunca chegava ao relógio sozinho**.

`src/utils/rep/enfileirarCadastrosParque.ts`, chamado pelo cron diário, roda **as duas** RPCs para
todo dispositivo ativo.

⚠️ **Roda com `service_role`, e é isso que a faz funcionar:** as duas RPCs só aplicam o guard de
papel e o de escopo quando `auth.uid() IS NOT NULL`. Com `createClient()` a rotina veria zero.

⚠️ **Não escreve no equipamento** — só popula `rep_cadastros_fila`. Quem grava no relógio é o
coletor, no ciclo dele, com teto de 20 por ciclo.

⚠️ **O relatório lista só os dispositivos que ganharam gente na fila** (armadilha 22): imprimir os
29 com "0 enfileirados" faria parecer trabalho onde não houve nenhum.

## Conferência depois de aplicar (produção, 05/09/2026)

| conferência | resultado |
|---|---|
| `total_pessoas` | **3.431** (previsto 3.430) |
| `escalados` preservado | **1.785** — idêntico ao anterior ✅ |
| `sem_biometria` revelado | **1.259** |
| USF José Manoel | **os 4 listados**, todos `ok` com biometria ✅ |
| Servidor Externo preservado | **22** ✅ |
| linhas duplicadas por dispositivo | **0** ✅ |

Homologação: as duas RPCs de enfileiramento aceitam `service_role` e devolvem o formato esperado
(`{enfileirados, ja_na_fila}`), com 1 pessoa realmente enfileirada no teste.

## Ficou pendente

- **O travamento de 4 minutos do relógio da USF José Manoel** — precisa do teste ping × 443 durante
  um novo episódio para separar firmware de hardware.
- **As três melhorias do coletor** (um `rep.Client` por ciclo em vez de três, não listar usuários
  com `0 pendente(s)`, retry curto nas leituras). Reduzem a carga sobre um equipamento que gasta
  1,1s por handshake, mas **não resolvem o travamento** — não foram feitas nesta rodada.
- **ESLint não está instalado na máquina de dev** (`next lint` falha com "ESLint must be
  installed"); o CI continua sendo o portão.
