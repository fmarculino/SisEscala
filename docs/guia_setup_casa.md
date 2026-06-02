# Guia de Configuração - Ambiente Doméstico (Casa)

Este guia orienta o passo a passo para configurar o ambiente de desenvolvimento local na sua máquina de casa, garantindo que ela aponte com segurança para o banco de desenvolvimento do Supabase Cloud (`sisescala-dev`) sem interferir no banco de produção.

---

## Passo 1: Obter o Código do GitHub
Se você já tiver o repositório clonado em casa, mude para a branch de trabalho:
```bash
git checkout feature/nova-funcao-trabalho
git pull origin feature/nova-funcao-trabalho
```

Caso esteja clonando o projeto do zero na máquina de casa:
```bash
git clone https://github.com/fmarculino/SisEscala.git
cd SisEscala
git checkout feature/nova-funcao-trabalho
```

---

## Passo 2: Configurar as Variáveis de Ambiente locais (.env)
Como os arquivos `.env` estão protegidos no `.gitignore`, eles não sobem para o GitHub. Você precisará criá-los manualmente na raiz do projeto em casa.

1. Crie um arquivo chamado `.env` na raiz do projeto.
2. Crie outro arquivo chamado `.env.development` na raiz do projeto.
3. Insira o seguinte conteúdo em ambos os arquivos (substitua os placeholders pelas chaves reais fornecidas no chat):
```env
NEXT_PUBLIC_SUPABASE_URL=https://mtgfmxsbsyknotvwzdcr.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=SUA_CHAVE_ANON_DE_DESENVOLVIMENTO
```

*(Opcional)* Se tiver o arquivo `.env.production` ou `.env..production` localmente em casa, lembre-se de que ele não deve ser enviado ao Git.

---

## Passo 3: Instalar as Dependências
Abra o terminal na pasta do projeto e instale os pacotes:
```bash
npm install
```

---

## Passo 4: Rodar o Sistema Localmente
Inicie o servidor de desenvolvimento local:
```bash
npm run dev
```

Abra o navegador em `http://localhost:3000` (ou na porta que o terminal indicar) e faça login no painel administrativo utilizando a conta de desenvolvedor master:
* **Usuário:** `admin@admin.com`
* **Senha:** *fornecida no chat privado*

---

## Observações Importantes:
* **Banco já Inicializado:** O banco de dados de desenvolvimento na nuvem (`sisescala-dev`) já está totalmente configurado com as tabelas, triggers, enums e o usuário master. Você não precisa rodar scripts de migração iniciais em casa para que o sistema funcione.
* **Futuras Migrações:** Se você alterar a estrutura do banco em casa e criar novos arquivos em `supabase/migrations/`, eles serão compartilhados via Git. Quando chegar no trabalho, bastará fazer `git pull` e aplicar.
