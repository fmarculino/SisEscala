# Copiar cartão RFID, código e senha entre relógios da mesma unidade

**06/09/2026.** Pendência aberta, **sem implementação e sem teste em hardware**. Nasce de uma
pergunta do usuário depois da conversa sobre sincronização de cadastro e de biometria: *"ao
sincronizar a biometria sincroniza também se a pessoa bate com cartão ou com código e senha?"*

**Não sincroniza.** A cópia automática (v0.10.0, 25/08/2026) move **exclusivamente o template
biométrico**. Cartão, código e senha não são copiados — e nem sequer são lidos do equipamento.

Ambiente escolhido para testar: **HMM**, onde os três cenários existem juntos. Adiado até alguém
estar fisicamente lá (decisão do usuário, 06/09/2026).

---

## O que foi verificado no código (06/09/2026)

| ponto | o que se apurou |
|---|---|
| escrita da biometria | [`rep/client.go`](../../tools/coletor-rep/rep/client.go), `formatosTemplate` — **todos** os candidatos mandam só `name`, `pis`/`cpf`, `registration` e `templates`. Nenhum tem `rfid`, `code`, `password` ou `barras` |
| leitura do cadastro | `ListarUsuarios` aproveita `pis`, `registration`, `code`, `name` e `templates`. O equipamento **devolve `rfid`** (registrado em comentário desde 12/08/2026) e o coletor **descarta** — não existe campo para ele em `UsuarioDispositivo` |
| criação de cadastro | `CriarUsuario` / `formatosCadastro` enviam `name`, `registration`, `cpf`/`pis` e `admin:false`. Sem cartão, sem senha |
| CSV do pendrive | `cadastros-exportar` ([`cmd/cli/main.go`](../../tools/coletor-rep/cmd/cli/main.go)) grava `rfid=0`, `codigo=0`, `senha` e `barras` **vazios** |
| banco | `rep_usuarios_dispositivo` só tem `tem_biometria` (booleano). **Nenhuma** coluna de cartão, código ou senha em nenhuma migration — a única ocorrência de `rfid` no schema é comentário histórico |
| fila de cópia | `fn_biometria_faltante_dispositivo` (`20260825130000`) mede **só digital**: `NOT u.tem_biometria` no destino, `u2.tem_biometria` na origem |

---

## Por que isso morde

1. **Quem usa cartão vira pendência eterna.** A pessoa entra na lista como faltando digital no
   relógio destino, a cópia é tentada, e falha com *"o relógio de origem não tem digital
   cadastrada"* — `templates` vem vazio. Recusa reportada, 24 h fora da fila (`rep_biometria_copias`),
   e repete indefinidamente.
2. **"Sincronizar cadastros" entrega alguém sem nenhum meio de bater.** O cadastro chega ao
   equipamento novo com nome, matrícula e CPF/PIS — e mais nada. Quem batia por cartão no relógio
   antigo fica cadastrado e **incapaz de registrar ponto** até alguém ir presencialmente.
3. **A Cobertura de Ponto conta essa gente como "sem biometria"**, o que está tecnicamente certo e
   operacionalmente enganoso: elas *conseguem* bater onde têm cartão, e a cópia automática nunca
   vai resolver o outro relógio.
4. **A batida em si não distingue nada.** A linha tipo 3 do AFD carrega só NSR + data/hora +
   identificador + CRC — não diz por qual meio a pessoa se identificou. Ponto por cartão entra
   igual ao de digital, e o SisEscala não sabe (nem pode saber) a diferença.

---

## O que precisa ser descoberto, e nesta ordem

**Passo 1 — diagnóstico, sem escrever nada.** Imprimir a resposta crua de `load_users.fcgi`
(`templates: true`) para um usuário que **use cartão** e para um que **use senha**, no HMM.
Responde de uma vez:

- `rfid` vem preenchido, vem zerado, ou só existe para quem tem cartão?
- `code` está sendo usado como "código do usuário" ou como outra coisa?
- **a senha aparece?** Provavelmente **não** — equipamento raramente devolve senha em listagem
  (sai como hash ou não sai). Se não vier, não há o que copiar: senha teria que ser redigitada.

Sonda com **corpo vazio** continua sendo o jeito barato de separar "campo não existe" de "campo
com valor errado", como já foi usado para achar `update_users.fcgi`.

**Passo 2 — decidir o que copiar.** Provável ordem de viabilidade: **RFID > código > senha**.

**Passo 3 — escrever, com conferência nova.** `update_users.fcgi` já é o comando confirmado em
campo; acrescentar `rfid`/`code` ao corpo é mudança pequena.

---

## 🚨 As duas armadilhas que já são conhecidas antes de começar

1. **Nunca mandar campo sem `name`/`registration` junto.** Se um firmware tratar `update_users`
   como substituição do objeto inteiro, o cadastro perde nome e matrícula. Já está escrito como
   aviso em `formatosTemplate` — vale igual aqui.
2. **A conferência atual NÃO pega perda de campo.** `descobrirFormatoTemplate` confere biometria
   ganha, cadastro que cresceu e cadastro que sumiu — ela **não olha os campos de quem ficou**.
   Um formato que grave o cartão certo e apague o nome passaria por ela. Copiar cartão exige uma
   conferência que compare os campos do alvo antes/depois, **antes** de rodar sobre cadastro de
   servidor real.

Portão de campo, como nos outros: exercitar contra o descartável
**"SISESCALA TESTE - PODE APAGAR"**, com cartão cadastrado **nele**, nunca com o cartão de um
servidor real.

---

## Estado

**Aberto.** Nada implementado, nada testado. Próximo passo é o diagnóstico do passo 1, no HMM.
