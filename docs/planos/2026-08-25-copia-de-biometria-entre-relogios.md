# Copiar biometria de um relógio para outro da mesma unidade

**25/08/2026.** Motivado pelas unidades com **mais de um relógio** (há unidades com 4). Se qualquer
servidor pode bater em qualquer equipamento, ele precisa estar cadastrado **com digital** em todos
— e cadastrar digital é presencial, servidor por servidor, relógio por relógio.

A pergunta era: dá para copiar a biometria já cadastrada de um relógio para os outros, ou cada
pessoa precisa encostar o dedo em cada equipamento?

**Dá para copiar.** Por pendrive, hoje, sem escrever uma linha de código.

---

## O que está confirmado contra hardware real

| fato | quando | onde |
|---|---|---|
| "Enviar/Receber usuários" usa **CSV `;` com cabeçalho**, não formato proprietário | 14/08/2026, REP-iDClass-CEI | CLAUDE.md, Fase 6 |
| A coluna `digitais` do CSV traz **o template biométrico em base64** | 14/08/2026 | idem |
| "Receber usuários" é **aditivo** — não substitui a lista do equipamento | 14/08/2026 (testado com 67 cadastros reais + 1 de teste) | idem |
| `load_users.fcgi` com `templates: true` **devolve os templates** pela API | 12/08/2026 | [`rep/client.go`](../../tools/coletor-rep/rep/client.go) — hoje o coletor só olha `len(templates) > 0` e descarta o conteúdo |

```
cpf;nome;administrador;matricula;rfid;codigo;senha;barras;digitais
76107426272;Luciede de Jesus Alves;0;58534;0;0;;;<base64 do template, quando tem>
```

## O que NÃO está confirmado

- **Se o template exportado do relógio A é aceito pelo relógio B.** É plausível entre equipamentos
  do mesmo modelo/firmware (mesmo algoritmo de extração), e é o que o formato sugere — mas
  ninguém passou um arquivo de verdade de um equipamento para outro ainda. Entre modelos
  diferentes, desconhecido.
- **Escrever template pela API** (`add_users.fcgi` com o campo de templates, ou um comando
  próprio). Nunca testado. É o que a automação exigiria.

---

## Procedimento manual (fazer hoje)

1. **No relógio que já tem as digitais**: menu do equipamento → *Enviar usuários* → pendrive.
   Gera o CSV com a coluna `digitais` preenchida.
2. **Antes de levar ao destino, teste com uma pessoa.** Copie o arquivo, deixe **o cabeçalho + uma
   linha só** (alguém que possa conferir na hora) e receba esse arquivo reduzido no relógio de
   destino. "Receber usuários" é aditivo — nada do que já está no destino se perde —, e aí a
   pessoa encosta o dedo no destino para confirmar que o template atravessou.
3. **Confirmado o teste**, receba o arquivo inteiro no destino: menu → *Receber usuários*.
4. **Feche o loop no SisEscala**: na bandeja do coletor, *"Atualizar lista de cadastros do
   relógio"* (ou `coletor-rep-cli higiene --dispositivo <relógio de destino>`). O snapshot passa a
   mostrar quem está lá e com biometria.
5. **Confira na aba Cobertura da Escala** do relógio de destino: quem foi copiado sai de
   `fora_do_relogio` e vira `ok` (ou `sem_vinculo`, que "Sincronizar cadastros" resolve).

### ⚠️ Antes de copiar entre relógios de origens diferentes: confira o identificador

Nem todo equipamento identifica pela mesma coisa. Os relógios da TI, LACEM e CEI foram cadastrados
por **CPF**; o da SMS veio de outro sistema cadastrado por **PIS** (armadilha 10 do CLAUDE.md).
Copiar o CSV de um relógio-CPF para um relógio-PIS cria os cadastros lá com CPF — o SisEscala
resolve as duas formas (`fn_servidor_por_identificador_afd`), então o ponto não se perde, **mas a
pessoa que já existia no destino sob PIS passa a ter dois cadastros no mesmo equipamento**.

Rode a **Higiene do Relógio** no destino depois da cópia e verifique duplicidade antes de tratar a
unidade como pronta.

### ⚠️ O que a cópia não resolve

Quem **não tem digital em relógio nenhum** continua precisando cadastrar presencialmente uma vez.
A cópia distribui o que já existe; não cria biometria.

---

## Automação — IMPLEMENTADA em 25/08/2026 (coletor v0.10.0), travada até o teste de campo

O objetivo é que ninguém mexa em pendrive de novo: cadastrou a digital num relógio da unidade, os
outros recebem sozinhos.

### O que já era automático antes disto

A **detecção**. O ciclo do coletor já lê o cadastro de cada relógio e reporta quem tem biometria
(`ciclo.SincronizarCadastros` → `ReportarBiometria` + o snapshot de `rep_usuarios_dispositivo`). O
SisEscala já sabia, sozinho, que fulano tem digital no relógio A e não no B. Faltava o transporte.

### O desenho

```
SisEscala  →  "no relógio B faltam 12 digitais; o relógio A tem"   (só nomes e identificadores)
                        ↓
coletor da unidade  →  lê template de A  →  grava em B  →  relista e confirma
                        ↓
SisEscala  ←  "10 copiadas, 2 falharam"                            (contagem, nunca o dado)
```

⚠️ **O template não passa pelo servidor.** A cópia é equipamento → equipamento, dentro da unidade.
Dois motivos, cada um suficiente: dado biométrico é sensível (LGPD), e o servidor não tem rota de
rede até os relógios.

| peça | onde |
|---|---|
| quem falta e onde buscar | `fn_biometria_faltante_dispositivo` (`20260825130000`) |
| auditoria do que se moveu | `rep_biometria_copias` — sem template, só a contagem |
| o coletor pergunta / reporta | `GET`/`POST /api/rep/v1/biometria-copias` |
| leitura do template | `rep.ListarUsuarios` — já vinha com `templates: true`, agora preserva o conteúdo cru |
| escrita | `rep.GravarTemplates` — varredura de formatos com confirmação por relistagem |
| orquestração | `ciclo.SincronizarBiometria` / `...Todos` |
| gatilho | menu da bandeja **"Copiar biometria entre os relógios"** e `coletor-rep-cli biometria-sincronizar` |

### Regras que não podem ser desfeitas

- **Não cria usuário.** A cópia só alcança quem já está cadastrado no destino sem digital; quem não
  está é assunto da fila de identidade (`rep_cadastros_fila`), que já existe. É isso que torna
  impossível duplicar cadastro no equipamento.
- **Duas conferências depois de escrever**: só o alvo pode ter ganhado biometria, e o cadastro não
  pode ter crescido. A segunda pega o formato que "funciona" criando um usuário novo — que passaria
  pela primeira e seria pior que a falha.
- **Falha de transporte não queima a pendência.** Rede/timeout é retentado; recusa do equipamento é
  registrada (e a pendência fica 24h fora da fila, para não repetir o mesmo erro a cada rodada).
- **Fora do ciclo automático** enquanto o formato de escrita não for confirmado em campo.

### O teste que destrava (rodar na unidade)

```
coletor-rep-cli cadastros-testar --dispositivo <relógio A>
   → cadastre UM DEDO SEU no usuário "SISESCALA TESTE - PODE APAGAR" (matrícula 900000), no
     próprio equipamento
coletor-rep-cli biometria-testar --de <relógio A> --para <relógio B>
   → encoste o mesmo dedo no relógio B: se ele reconhecer, funciona
```

⚠️ **A digital do teste é de um dedo cadastrado no próprio usuário descartável, nunca a de um
servidor real.** Copiar o template de alguém para o usuário de teste faria aquele dedo abrir um
cadastro que não é o dele.

O comando imprime **qual formato o equipamento aceitou** — é esse nome que precisa ser reportado
para o candidato virar o primeiro da lista em `rep.formatosTemplate`, como já foi feito com
`remove_users.fcgi` depois da LACEM.

**Enquanto o teste não for feito, o pendrive continua sendo o caminho.** O custo de errar é gravar
template inválido no cadastro de um servidor real, e o sintoma é "a digital dele parou de
funcionar", descoberto por ele na frente do relógio.

## Nota de proteção de dados

O template biométrico é dado pessoal sensível (LGPD, Art. 5º, II). A cópia aqui é entre
equipamentos **do mesmo controlador** (SMS Maraba), para **a mesma finalidade** (registro de ponto
do mesmo servidor), e o dado não sai do parque da Secretaria — o pendrive vai de um relógio ao
outro. Ainda assim: **o pendrive não é lugar de guardar o arquivo.** Apague o CSV depois de
aplicar; ele carrega a digital de todo o quadro da unidade em texto legível por qualquer máquina.
