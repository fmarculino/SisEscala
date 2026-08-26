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

## Automação (depois, com janela de teste no equipamento)

O caminho está aberto porque a leitura já funciona: `ListarUsuarios` já pede `templates: true` e
recebe o array — basta parar de descartá-lo.

Desenho pretendido, na ordem:

1. `coletor-rep-cli biometria-copiar --de <relógio> --para <relógio>` na **CLI**, nunca na bandeja
   nem no ciclo automático — mesma prudência de `cadastros`/`higiene-remover`: escrita em
   equipamento de produção só por comando explícito de quem está na unidade.
2. **Varredura de formatos com confirmação por relistagem**, exatamente como
   `remove_users.fcgi` exigiu em 13/08/2026: o `ok` do equipamento não é prova. Depois de
   escrever, relistar e conferir que aquele usuário passou a ter template — e **abortar a
   execução inteira** se a escrita afetar quem não era o alvo.
3. **`coletor-rep-cli biometria-testar`** primeiro, contra o descartável
   "SISESCALA TESTE - PODE APAGAR", como `cadastros-testar` e `remocao-testar` já fazem.
4. Só então considerar um botão na tela.

**Não automatizar antes do teste em campo.** O custo de errar aqui é gravar template inválido no
cadastro de servidor real num equipamento de produção — e o sintoma seria "a digital dele parou de
funcionar", descoberto pelo servidor na frente do relógio.

## Nota de proteção de dados

O template biométrico é dado pessoal sensível (LGPD, Art. 5º, II). A cópia aqui é entre
equipamentos **do mesmo controlador** (SMS Maraba), para **a mesma finalidade** (registro de ponto
do mesmo servidor), e o dado não sai do parque da Secretaria — o pendrive vai de um relógio ao
outro. Ainda assim: **o pendrive não é lugar de guardar o arquivo.** Apague o CSV depois de
aplicar; ele carrega a digital de todo o quadro da unidade em texto legível por qualquer máquina.
