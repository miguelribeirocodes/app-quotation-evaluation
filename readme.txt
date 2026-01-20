Como iniciar o venv:

Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
python -m venv .venv
.\.venv\Scripts\Activate.ps1

Como iniciar localmente:

uvicorn main:app --reload

Requirements:

pip install -r requirements.txt
pip install "python-jose[cryptography]" passlib[bcrypt]

================================================================================
CONFIGURAÇÃO DO BANCO DE DADOS LOCAL (PostgreSQL)
================================================================================

PASSO 1: Instalar PostgreSQL
- Baixar em: https://www.postgresql.org/download/
- Durante a instalação, defina a senha do usuário 'postgres' como: 99062535
- Selecione a porta padrão: 5432

PASSO 2: Iniciar o PostgreSQL (Windows)
- Abra "Services" (Win+R > services.msc)
- Procure por "postgresql-x64-XX" (onde XX é a versão)
- Clique com botão direito > Properties
- Defina "Startup type" como "Automatic"
- Clique em "Start"

PASSO 3: Criar o banco de dados (via PowerShell)
```
psql -U postgres -h localhost
```
Digite a senha: 99062535

Depois execute no psql:
```
CREATE DATABASE postgres;
\q
```

PASSO 4: Executar o schema (criar tabelas)
Opção A - Via DBeaver:
- Instale DBeaver: https://dbeaver.io/
- Crie uma nova conexão PostgreSQL (localhost:5432, user: postgres, password: 99062535)
- Abra "schema_avaliacoes.sql"
- Execute todo o SQL (Ctrl+Enter ou botão Run)

Opção B - Via psql:
```
psql -U postgres -h localhost -d postgres -f schema_avaliacoes.sql
```

PASSO 5: Verificar a conexão
Na raiz do projeto, o arquivo `.env` deve conter:
```
DATABASE_URL=postgresql://postgres:99062535@localhost:5432/postgres
```

PASSO 6: Rodar a aplicação
```
.\.venv\Scripts\Activate.ps1
uvicorn main:app --reload
```

A aplicação estará em: http://localhost:8000
Usuário padrão: admin
Senha padrão: admin123 (mude no primeiro acesso!)

DICAS:
- Se receber erro de conexão, verifique se PostgreSQL está rodando (Services)
- Se receber erro de autenticação, verifique a senha em .env vs instalação
- Para parar a aplicação: Ctrl+C no terminal

Quando realizar alterações no código:

- Fazer commit no git para o Render reiniciar deploy;
- Subir html, js e css no netlify.

Funciona no link: https://quotation-evaluation.netlify.app/

================================================================================
SISTEMA DE ROLES (PERFIS DE USUÁRIO)
================================================================================

O sistema possui três perfis de usuário com diferentes níveis de acesso:

--------------------------------------------------------------------------------
1. ADMINISTRADOR (role: "admin")
--------------------------------------------------------------------------------
   Acesso completo ao sistema. Pode:
   
   ✓ Criar, editar e excluir avaliações
   ✓ Alterar o STATUS de qualquer avaliação
   ✓ Preencher campos comerciais (Pedido de Compra, Número da Proposta)
   ✓ Criar novos usuários
   ✓ Alterar o perfil (role) de outros usuários
   ✓ Ativar/desativar usuários
   ✓ Resetar senha de usuários
   ✓ Acessar a seção de Auditoria (histórico de alterações)
   ✓ Gerar PDF de lista de materiais (futuro)
   
   Observação: O usuário "admin" padrão do sistema não pode ter seu perfil
   alterado ou ser desativado.

--------------------------------------------------------------------------------
2. COMERCIAL (role: "comercial")
--------------------------------------------------------------------------------
   Acesso intermediário focado em atividades comerciais. Pode:
   
   ✓ Criar, editar e excluir avaliações
   ✓ Alterar o STATUS de qualquer avaliação
   ✓ Preencher campos comerciais (Pedido de Compra, Número da Proposta)
   ✓ Gerar PDF de lista de materiais (futuro)
   
   ✗ NÃO pode gerenciar usuários
   ✗ NÃO pode acessar a seção de Auditoria

--------------------------------------------------------------------------------
3. AVALIADOR (role: "avaliador")
--------------------------------------------------------------------------------
   Acesso básico para operação do dia-a-dia. Pode:
   
   ✓ Criar e editar avaliações
   ✓ Usar rascunhos (salvamento local)
   ✓ Visualizar avaliações
   
   ✗ NÃO pode alterar o STATUS das avaliações (campo somente leitura)
   ✗ NÃO pode preencher campos comerciais
   ✗ NÃO pode gerenciar usuários
   ✗ NÃO pode acessar a seção de Auditoria
   ✗ NÃO pode gerar PDF de lista de materiais

================================================================================
MIGRAÇÃO DE BANCO DE DADOS
================================================================================

Para sistemas já em produção, execute os seguintes comandos SQL:

-- Adicionar coluna role para sistema de papéis
ALTER TABLE usuarios ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'avaliador';
UPDATE usuarios SET role = 'admin' WHERE is_admin = TRUE;
UPDATE usuarios SET role = 'avaliador' WHERE is_admin = FALSE;

-- Adicionar campos comerciais
ALTER TABLE avaliacoes ADD COLUMN pedido_compra VARCHAR(100);
ALTER TABLE avaliacoes ADD COLUMN numero_proposta VARCHAR(100);

================================================================================

Próximos passos:

- Testar seção painel de automação e portas
- Ver como vamos fazer a seção de catracas (será q6)
- Seção para software (será q7)
- Incluir seção para fotos
- Corrigir visualização da tabela tanto no navegador quanto no mobile. Uma vez eu fiz isso corrigindo outro componente que estava esticando tudo, embora ainda acho que a tabela seja o problema.