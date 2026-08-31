# O servidor troca o próprio PIN — e o piso de 6 dígitos vale só daqui pra frente

**30/08/2026** · migration `20260830170000_troca_de_pin_pelo_servidor.sql` · v2.30.0

---

## De onde veio

Da conversa sobre enviar o PIN por e-mail. Ao descrever por que o e-mail é o caminho preferido
para credencial, ficou explícito o que já era verdade e ninguém tinha nomeado:

> **O PIN é gerado pelo coordenador e transmitido por um canal.** Pelo menos duas pessoas
> conhecem cada PIN de cada servidor.

Isso não é um defeito de implementação — é o desenho. Mas significa que o PIN nunca foi uma
credencial *pessoal*; era um segredo compartilhado com quem cadastrou. A pergunta do usuário
("acho importante o servidor ter no portal a possibilidade de ele mesmo mudar o pin dele") é a
correção natural disso.

É também a saída para uma decisão tomada dias antes: em 30/08/2026, ao fechar `verify_pin` do
`anon` (armadilha 24 → `20260830110000`), ficou registrado que **os PINs de 4 dígitos já emitidos
não seriam trocados à força** — seriam substituídos naturalmente. Sem um caminho de troca, "com o
tempo" era um prazo sem mecanismo.

---

## A pergunta difícil: como exigir mais dígitos sem quebrar quem já tem 4?

O usuário colocou a restrição com precisão:

> *"minha ressalva é que muitos já receberam os seus pins, uma mudança agora seria ruim. Tem como
> exigir um pin maior só a partir de agora e continuar aceitando os antigos de 4 dígitos até todos
> terem mudado?"*

**Tem, e não é um truque — é onde a regra mora.**

| caminho | o que ele faz | conhece o tamanho? |
|---|---|---|
| **login** (`fn_validar_pin_portal` → `verify_pin`) | `v_hash = crypt(p_pin, v_hash)` | **não**, e não precisa |
| **escrita** (`hash_servidor_pin` → `fn_validar_pin_novo`) | valida e aplica bcrypt | **sim** |

O login **só compara hash**. Ele nunca soube quantos dígitos o PIN tem, e não há nada a mudar
nele. Então a regra nova alcança exclusivamente quem **define um PIN novo**, e PIN de 4 dígitos já
emitido continua entrando **para sempre, sem exceção e sem prazo** — no Portal e no terminal.

🚨 **A refatoração razoável que quebraria isso.** Um dia alguém vai olhar duas funções chamadas
`fn_validar_pin_*` e querer "uniformizar", fazendo o login chamar a regra. No instante seguinte,
**826 pessoas perdem o Portal e o terminal de ponto ao mesmo tempo**, e o sintoma é *"ninguém
consegue bater o ponto hoje"*. A migration aborta se detectar isso:

```sql
IF EXISTS (SELECT 1 FROM pg_proc
            WHERE oid = 'public.fn_validar_pin_portal(text, text)'::regprocedure
              AND prosrc ILIKE '%fn_validar_pin_novo%')
THEN RAISE EXCEPTION 'ABORTADO: ... a regra de tamanho vale na ESCRITA, nunca no LOGIN ...';
```

Forçar a troca dos antigos **é possível** — seria barrar no login. Mas é uma decisão diferente
desta, com custo diferente, e não foi tomada.

---

## Onde a regra mora: no trigger, não só na RPC

`trigger_hash_servidor_pin` existe desde `20260523000000` e já era o **funil** por onde todo PIN
passa antes de virar hash. As duas telas do coordenador e a RPC nova caem nele. Validar ali é o
padrão da armadilha 23 — trigger como rede de segurança, RPC como o caminho que carrega a
mensagem legível — e é o que faz um caminho de escrita futuro herdar a regra sem precisar lembrar
dela. A armadilha 14 e a 23 documentam, duas vezes, o que acontece quando alguém esquece.

⚠️ **Recriar `hash_servidor_pin` é armadilha 1.** Os dois guards originais precisam sobreviver:

| guard | o que quebra sem ele |
|---|---|
| `NOT LIKE '$2a$%' AND NOT LIKE '$2b$%'` | todo UPDATE em `servidores` aplica hash **sobre o hash** — o parque inteiro perde acesso ao Portal e ao terminal de uma vez |
| `IS DISTINCT FROM OLD.pin_acesso` | a validação nova reprovaria os 4 dígitos **legados** em qualquer edição de ficha, e o coordenador não conseguiria mais salvar o cadastro de ninguém |

O segundo é o mais fácil de perder de vista: ele não protege o PIN, protege **todo o resto do
cadastro** de quem tem PIN legado.

---

## As defesas da troca

| regra | por quê |
|---|---|
| `p_servidor_id` vem da **sessão assinada**, nunca do cliente | armadilha 32 — derivar em vez de comparar. O portão `sim_portal_sessao.js` já cobre a ação nova automaticamente (32 actions, 0 recebendo `servidorId`) |
| **exige o PIN atual** | o cookie do Portal dura horas e a tela roda em máquina compartilhada de unidade. Sessão aberta prova que *alguém* entrou, não que quem está na frente agora seja a mesma pessoa |
| **reusa o contador de tentativas do login** | sem isso a troca vira um oráculo para adivinhar o PIN atual **sem trava** — exatamente o furo que a `20260830110000` fechou no login, reaberto por uma porta ao lado |
| a regra do PIN novo só é avaliada **depois** de conferir o atual | quem não provou ser dono da conta não deve receber nem a informação de qual é a regra |
| trocar por um PIN igual ao atual é **recusado** | seria um no-op disfarçado de sucesso: a pessoa sairia achando que trocou |
| `logs_troca_pin` guarda quem, quando e de onde — **nunca o valor, nem o hash** | PIN é credencial de ponto; troca de credencial precisa ser auditável, e o log não pode virar o próprio vazamento |

A tabela não tem policy de `INSERT`, e **não ter é o certo**: a escrita é exclusivamente por
`SECURITY DEFINER`, então ninguém grava direto pelo PostgREST.

---

## 🚨 O aviso que faz a tela existir sem virar armadilha

Este PIN **não é só do Portal**. `fn_registrar_ponto` usa a mesma credencial. Quem troca à noite e
tenta bater o ponto de manhã com o antigo **leva recusa** — e, pela conformidade da v1.22.0,
matrícula/PIN inválidos é a **única** coisa que ainda recusa batida: vira linha em
`logs_tentativas_presenca` e **não vira ponto**.

Quem descobre isso na frente do relógio, com fila atrás, perde a batida do dia. Por isso o bloco
âmbar no topo de `TrocarPinSection` não é decoração:

> **Este PIN também é o que você usa para bater o ponto.**
> Depois de trocar, o PIN antigo não funciona mais — nem aqui no Portal, nem no terminal de
> presença da sua unidade. Guarde o novo antes de confirmar.

---

## Duas mudanças que vieram por necessidade

**O gerador.** `Math.floor(1000 + Math.random() * 9000)` vivia nas duas telas do coordenador.
Deixá-lo lá faria o botão "Gerar PIN" produzir um valor que o **próprio banco recusa** — a tela
pareceria quebrada por um acerto de regra. E sortear às cegas não basta: `000000` e `123456` estão
no espaço amostral. `gerarPin` redesenha até passar na própria regra, **com teto** — um
`while (true)` num gerador é um travamento esperando um bug de regra.

**A tradução do erro.** Sem ela, o coordenador que digitasse 4 dígitos na mão receberia o texto
cru do `RAISE` do Postgres. `traduzirErroCadastro` (que já era o tradutor único daquele arquivo)
passou a mapear `23514` + `PIN recusado (<código>)` para `mensagemRecusaPin`.

---

## O que se decidiu NÃO fazer

- **Faixa de reconsentimento / troca obrigatória.** Barrar no login tira gente do ar; a decisão do
  usuário foi rotação natural.
- **Exigir 6 dígitos de todos os PINs existentes.** Mesma coisa, pelo mesmo motivo.
- **Lista de PINs proibidos.** `fn_pin_e_sequencia` é estrutural (todo par de dígitos vizinhos
  difere de +1 ou de −1); lista envelhece e depende do tamanho.
- **Aba própria no Portal.** A `💬 Avisos` virou `⚙️ Minha Conta` e agrupa preferência de aviso e
  troca de PIN — ninguém procuraria "trocar meu PIN" embaixo de "Avisos", e uma sexta aba na barra
  custaria mais do que resolve.

---

## Verificação

**Portão:** `node scratchpad/sim_troca_pin.js` — 56 casos.

⚠️ **Um portão que nunca falha não vale nada.** Ele foi validado injetando três regressões de
propósito, e as três reprovam:

| regressão injetada | reprovou |
|---|---|
| piso voltando para 4 dígitos | ✅ |
| trigger perdendo o guard de não re-hashear | ✅ |
| a regra de tamanho vazando para o caminho de login | ✅ |

⚠️ Uma asserção minha estava errada e foi corrigida: eu checava que a mensagem em português "não
contém o código do motivo", mas **`repetido` e `sequencia` são palavras legítimas em português** e
aparecem na frase certa. A asserção passou a ser "é uma frase, não o código cru".

**Medido em produção depois de aplicar** (a migration foi aplicada direto em produção pelo
usuário; a sonda executa as funções, porque "a função existe" não é prova — armadilha 42):

| conferência | resultado |
|---|---|
| `fn_validar_pin_novo` executada com 9 entradas | os 6 motivos de recusa corretos, o PIN válido aceito, piso lido = 6 |
| `fn_trocar_pin_portal` pelo `anon` | **HTTP 401** |
| `fn_validar_pin_novo` pelo `anon` | **HTTP 401** |
| `fn_trocar_pin_portal` executada (UUID inexistente) | `{"resultado":"nao_encontrado"}` — responde de verdade |
| PINs em produção | **826 com hash bcrypt, 0 em texto plano**, 566 sem PIN, 1.392 ativos |
| `pin_min_digitos` | `6` |

ℹ️ **Uma conferência ficou inconclusiva, e vale registrar em vez de arredondar:** a leitura de
`logs_troca_pin` pelo `anon` voltou vazia, mas **a tabela está vazia** — esse teste só prova de
verdade quando houver a primeira troca. A policy é `TO authenticated` com checagem de papel, e
`anon` não é authenticated.

**Falta o teste que só uma pessoa faz:** entrar em `/consultar-escala` e bater o ponto em
`/presenca` com uma matrícula cujo PIN tenha **4 dígitos**. É o que mais importa, e nenhuma sonda
substitui.
