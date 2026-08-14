# Implantação do CEI — relógio em rede, pendrive só como contingência (14/08/2026)

**Decisão de 14/08/2026:** garantir rede até o relógio do CEI, em vez de operar por pendrive.
Com isso a unidade volta ao caminho online já validado na LACEM em 13/08, e o pendrive fica
reservado para o caso extremo de a rede não estar disponível.

O que motivou a decisão: o pendrive anda **numa direção só**. Ele traz marcação do relógio para o
SisEscala e nada mais — cadastro de servidor não faz o caminho de volta. Como o quadro do CEI
ainda está sendo cadastrado no SisEscala, uma unidade pendrive-only exigiria digitar cada servidor
novo no teclado do equipamento e criar o vínculo por SQL, para sempre.

## 0. O que a rede precisa entregar

O coletor precisa de **dois** lados ao mesmo tempo:

```
[relógio REP] --(rede local, IP fixo)--> [PC do CEI + coletor] --(internet)--> [SisEscala]
```

Um PC com internet mas sem caminho até o relógio não serve — o coletor não teria com quem falar.
Um cabo direto entre o PC e o equipamento já resolve, ou um switch, se for mais prático.

Requisitos que costumam ser esquecidos:

- **IP fixo (ou reserva de DHCP) para o relógio.** Se o endereço mudar, o coletor perde o
  equipamento e a coleta para em silêncio.
- **O PC precisa ficar ligado *e com sessão de usuário aberta*.** O app de bandeja roda na sessão
  do usuário e dá autostart por `HKCU\...\Run` — isso foi deliberado (serviço do Windows roda na
  Sessão 0 e nunca conseguiria mostrar ícone nem abrir navegador). PC ligado na tela de login
  **não** coleta.
- **HTTPS na porta 443 até o relógio**, sem proxy no meio.

## 1. Provisionamento (uma vez)

A ordem importa em dois pontos: higiene **antes** do push de identidades (senão você empurra
cadastro para um relógio ainda sujo), e snapshot **de novo depois** do push (senão o vínculo não
enxerga quem acabou de entrar).

1. **Cadastrar o dispositivo** em Marcações → Dispositivos REP, com o IP definitivo.

   **Modo de operação: `Online com fallback de pendrive`.** Ele não é só rótulo — decide o
   indicador da lista ([`statusColetaDispositivo`](../../src/app/(dashboard)/marcacoes/MarcacoesClient.tsx)):
   nesse modo o status vira `Online` (contato ≤ 10 min), `Offline há Xh` em âmbar até 24 h e
   vermelho depois. É o monitoramento certo para um relógio coletado a cada 5 minutos. O modo
   `Só pendrive (usb)` trocaria isso pelo "última coleta por pendrive" e o dispositivo ficaria
   permanentemente vermelho como se nunca tivesse conectado.

2. Gerar token → **Baixar aplicativo** (.zip, app de bandeja) e, separado,
   [`coletor-rep-cli.exe`](../../src/app/api/coletor-rep/download-cli) — a CLI **não vem no .zip**.
3. No PC do CEI, executar o `.exe` do .zip. Ele se auto-instala em
   `%LOCALAPPDATA%\SisEscala\coletor-rep\` e registra o autostart sozinho.
   ⚠️ O **Smart App Control** do Windows pode bloquear o executável sem aviso claro (sem
   assinatura/reputação). Se acontecer, é preciso desligá-lo nas Configurações do Windows.
4. `coletor-rep-cli diagnostico` — tem que dar `login no REP: OK` **e** `heartbeat no SisEscala: OK`.
5. `coletor-rep-cli heartbeat` — reporta `deriva_segundos`. **Acerte a hora do relógio agora**:
   equipamento adiantado/atrasado contamina toda marcação que ele gravar.
6. `coletor-rep-cli afd-raw` — não grava nada. Confirma que este equipamento usa o mesmo layout
   (`DDMMYYYYHHMM`). Se as linhas não baterem, **pare** antes de qualquer ingestão.
7. `coletor-rep-cli sync` — primeira carga. O relógio é reaproveitado de outro sistema, então vem
   com histórico: tudo entra como **órfão**, que é exatamente o desejado. Marcação anterior à
   adoção não é ponto do SisEscala.
8. **Higiene**: `coletor-rep-cli higiene` (só leitura) → aba **Higiene do Relógio** → selecionar
   quem não é do quadro → `coletor-rep-cli remocao-testar` (num relógio novo, antes de tudo) →
   `coletor-rep-cli higiene-remover`.
9. **Identidades**: aba **Cobertura da Escala**, botão que enfileira **por escala**
   (`fn_enfileirar_cadastros_por_escala`) — não o "Sincronizar cadastros" do modal do dispositivo,
   que escolhe por **lotação** e deixa de fora, sem avisar, quem está escalado no CEI mas lotado
   em outro lugar (foi o caso de duas servidoras na LACEM). Depois `coletor-rep-cli cadastros`
   para aplicar no equipamento.
10. `coletor-rep-cli higiene` **de novo** — o snapshot precisa enxergar quem acabou de ser criado.
11. **Vínculos**: aba Cobertura → **Vincular por CPF** (`fn_vincular_cadastros_por_cpf`).
    `vigente_de` fica no `created_at` do dispositivo por padrão — **não mexa**. É o que impede o
    histórico do sistema anterior virar ponto do SisEscala num reprocessamento.
12. **Portão de saída**: na aba Cobertura, ninguém pode estar em `sem_vinculo`, `fora_do_relogio`
    nem `sem_snapshot`. `sem_biometria` é o único aceitável neste momento — resolve no passo 2.
    `sem_cpf` é cadastro incompleto no SisEscala e **não** se resolve no relógio.

## 2. Biometria

Cadastrar a digital de cada pessoa no próprio equipamento, presencialmente. Não há como empurrar
template por API: ele vem do sensor com a pessoa presente. Os usuários já existem (passo 9), então
é entrar em cada um e registrar o dedo.

Depois de uma rodada de digitais, rode **"Sincronizar cadastros agora"** no menu da bandeja (ou
`coletor-rep-cli cadastros`): é ele que relata ao SisEscala quem passou a ter biometria
(`ReportarBiometria` → `fn_atualizar_biometria_vinculos`) e limpa o `sem_biometria` da tela.
`coletor-rep-cli higiene` também atualiza esse campo, pelo snapshot.

## 3. Operação contínua

O app de bandeja roda `Sync` + `Heartbeat` a cada ~5 min, sozinho. **Só isso é automático.**

| ação | como roda | por quê |
|---|---|---|
| coleta de AFD e heartbeat | automático, ciclo de 5 min | leitura, sem risco |
| `cadastros` (push de identidade) | clique no menu da bandeja, ou CLI | escrita em equipamento de produção — prudência deliberada |
| `higiene` (snapshot) | botão na bandeja, ou CLI | só leitura, seguro rodar sempre |
| `higiene-remover` (apaga cadastro) | **só na CLI** | apaga dado no equipamento |

O que vigiar: o status do dispositivo na lista de Marcações (tem que dizer **Online**) e a aba
Cobertura da Escala.

### Servidor cadastrado depois da implantação

Com rede, é o caminho normal e sem SQL: enfileirar por escala na aba Cobertura → "Sincronizar
cadastros agora" na bandeja → digital presencial. O vínculo é criado sozinho quando o coletor
confirma o push (`fn_confirmar_cadastro_rep`).

**Pré-requisito:** CPF preenchido no SisEscala. Quem não tem CPF é pulado pela fila e a batida
dele não teria como ser atribuída a ninguém — o identificador do AFD **é** o CPF.

## 4. O erro que ninguém percebe

Medido na LACEM em 13/08: 27 de 39 escalados estavam cadastrados no relógio, com biometria,
encostavam o dedo, o relógio aceitava e gravava no AFD — e a batida morria órfã por falta de
`rep_vinculos_servidor`. **Nenhuma das duas pontas reclama.** Ao ouvir "o ponto de fulano não
aparece", confira o vínculo antes de suspeitar do equipamento.

É por isso que o passo 12 é um portão, não uma conferência opcional.

## 5. Contingência: coleta por pendrive

Só quando a rede até o relógio não estiver disponível. **Coleta apenas** — cadastro não faz o
caminho de volta por pendrive (`rep_cadastros_fila` e `rep_remocoes_fila` só saem do banco pelo
coletor online, via `GET /api/rep/v1/pendencias` e `/remocoes`).

Dois caminhos, conforme o que estiver quebrado:

| situação | como coletar |
|---|---|
| o PC perdeu internet, mas ainda enxerga o relógio | `coletor-rep-cli afd-exportar arquivo.sisrep` numa máquina que alcance o equipamento |
| ninguém alcança o relógio por rede | exportação de AFD pelo menu do próprio relógio para o pendrive |

Nos dois casos: SisEscala → Marcações → **Importar por Pendrive** → escolher o dispositivo →
enviar. Desde 14/08/2026 a importação aceita **os dois formatos**: o `.sisrep` do coletor (com
cabeçalho, que confere o `dispositivo_id`) e o AFD **cru** do relógio.

⚠️ O AFD cru vem **sem cabeçalho**, então **não há como o sistema conferir de qual equipamento
veio** — o dispositivo escolhido no formulário é a única fonte. Confira antes de clicar.

Reimportar é seguro: a ingestão é idempotente por (`dispositivo_id`, `nsr`). Se o menu do relógio
pedir período, exporte só desde a última coleta — sobrepor não duplica nada.

⚠️ **Não clique em "Sincronizar cadastros" enquanto o coletor estiver fora do ar.** A fila é
criada mas ninguém a consome, e a aba Cobertura passa a mostrar `fila_status = pendente`
indefinidamente, dando a impressão de que o cadastro está a caminho.

## 6. Pontos de atenção

- **`sync` reprocessa o AFD inteiro a cada 5 minutos.** Confirmado com dado real no log da LACEN
  (12/08): ~36 mil linhas por ciclo. Não corrompe nada — o atalho de idempotência por lote de
  `fn_ingerir_afd` devolve o resultado já calculado sem reprocessar — mas é desperdício, e o CEI
  entra como **mais um relógio reaproveitado, com histórico grande**. A correção conhecida é ler
  `dispositivos_rep.ultimo_nsr` antes de pedir o AFD, em vez de sempre pedir a partir do NSR 1.
  Com dois relógios de alto volume no ar, virou candidato a prioridade.
- **CPF duplicado bloqueia.** Duas matrículas com o mesmo CPF entre os escalados esbarram em
  `uq_vinculo_vigente`, que aceita um único vínculo vigente por (dispositivo, identificador). O
  relógio identifica pela digital e não sabe qual matrícula a pessoa está representando — é
  limitação de hardware, não de schema. Ver
  [`2026-08-13-vinculo-duplo-e-identificacao-no-rele.md`](2026-08-13-vinculo-duplo-e-identificacao-no-rele.md).
- **Confirmar no menu do relógio se ele importa cadastro por USB** (pendente de conferência em
  14/08). Se importar, existe caminho para tornar o pendrive bidirecional no futuro; se não
  importar, nenhum software do nosso lado resolve — e a decisão de garantir rede se confirma
  como a única saída para unidades assim.

## 7. Conferência de CPF antes de começar

Mês/ano fixos em `8` / `2026` — troque se escorregar para setembro.

```sql
WITH d AS (
    SELECT dr.id, dr.unidade_id,
           NOT EXISTS (SELECT 1 FROM public.dispositivos_rep_setores ds
                        WHERE ds.dispositivo_id = dr.id) AS toda_unidade
      FROM public.dispositivos_rep dr
     WHERE dr.nome = 'REP-iDClass-CEI'
), escalados AS (
    SELECT DISTINCT em.servidor_id
      FROM d
      JOIN public.escala_mensal em
        ON em.unidade_id = d.unidade_id AND em.mes = 8 AND em.ano = 2026
      JOIN public.escala_diaria ed ON ed.escala_mensal_id = em.id
     WHERE (d.toda_unidade
            OR EXISTS (SELECT 1 FROM public.dispositivos_rep_setores ds
                        WHERE ds.dispositivo_id = d.id AND ds.setor_id = em.setor_id))
       AND ed.categoria IS NOT NULL
       AND ed.categoria::text <> 'Sobreaviso'
)
SELECT s.matricula, s.nome, s.cpf,
       lpad(NULLIF(regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g'), ''), 12, '0')
           AS identificador_afd
  FROM escalados e
  JOIN public.servidores s ON s.id = e.servidor_id
 WHERE s.status = 'Ativo'
 ORDER BY 4 NULLS FIRST, 2;   -- sem CPF primeiro: sao os que precisam de conserto antes
```

Para achar CPF repetido, troque o `SELECT` final por um `GROUP BY 1 HAVING count(*) > 1` sobre o
`identificador_afd`.
