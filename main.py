# Alias para compatibilidade com Depends(get_current_user)
# ========================= main.py =========================
# Importações básicas da FastAPI
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form  # importa FastAPI, dependências, tipos de upload de arquivo e campos de formulário
from fastapi.staticfiles import StaticFiles                      # permite servir arquivos estáticos (HTML, CSS, JS, imagens)
from fastapi.responses import FileResponse                       # permite devolver um arquivo diretamente como resposta HTTP
from fastapi.middleware.cors import CORSMiddleware               # middleware que habilita CORS (acesso à API a partir de outros domínios)

# Importações do Pydantic para definir schemas de entrada/saída
from pydantic import BaseModel, Field                            # BaseModel é a base dos modelos Pydantic; Field permite meta-informações por campo

# Tipagem (para listas e opcionais)
from typing import List, Optional                                # List e Optional são usados para declarar listas e campos opcionais

# Módulos padrão de apoio
import json                                                      # módulo para manipular dados em formato JSON (logs, payloads, etc.)
import secrets                                                   # módulo para gerar valores aleatórios criptograficamente seguros (tokens, senhas)
import string                                                    # módulo com constantes de letras/dígitos, útil para montar senhas
import shutil  # módulo auxiliar para copiar o conteúdo de arquivos enviados (UploadFile) para o disco

from datetime import date, datetime, timedelta                   # tipos de data, data/hora e diferença de tempo

from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm  # ferramentas de login via OAuth2 (form padrão de formulário)

from jose import JWTError, jwt                                   # biblioteca para criar e validar tokens JWT
from passlib.context import CryptContext                         # contexto do Passlib para hash/validação de senhas

# Importações do SQLAlchemy para ORM
from sqlalchemy import (                                         # importa vários elementos do SQLAlchemy
    create_engine,                                               # função para criar o "engine" de conexão com o banco
    Column,                                                      # classe para definir colunas
    Integer,                                                     # tipo inteiro
    String,                                                      # tipo string (tamanho fixo/limitado)
    Boolean,                                                     # tipo booleano (True/False)
    Text,                                                        # tipo texto longo
    Date,                                                        # tipo data
    Numeric,                                                     # tipo numérico com casas decimais
    ForeignKey,                                                  # para chaves estrangeiras
    TIMESTAMP,                                                   # tipo data/hora
    func                                                         # funções SQL, como func.now()
)

from sqlalchemy.orm import (                                     # importações para o ORM trabalhar
    declarative_base,                                            # base para declarar modelos ORM
    sessionmaker,                                                # fábrica de sessões
    relationship,                                               # relacionamento entre tabelas
    Session                                                      # tipo da sessão
)

# Importação para ler variáveis de ambiente
import os                                                         # biblioteca padrão para lidar com sistema de arquivos e variáveis de ambiente
import re                                                         # biblioteca padrão para sanitizar strings (ex.: contexto) com regex
import uuid                                                       # biblioteca padrão para gerar identificadores únicos (nomes de arquivo)
from dotenv import load_dotenv                                    # carrega variáveis de ambiente a partir do arquivo .env

# Carrega variáveis de ambiente do arquivo .env (se existir)
load_dotenv()                                                   # carrega o arquivo .env na raiz do projeto, se presente
# -----------------------------------------------------------
# Configuração do banco de dados (somente Postgres, sem fallback)
# -----------------------------------------------------------

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "uploads")  # define a pasta onde os arquivos de imagem serão salvos (pode ser configurada via variável de ambiente)
os.makedirs(UPLOAD_DIR, exist_ok=True)  # garante que a pasta de uploads exista na inicialização da aplicação

# Lê a URL do banco de dados a partir da variável de ambiente DATABASE_URL (sem valor padrão)
DATABASE_URL = os.getenv("DATABASE_URL")                         # tenta buscar a variável no ambiente/.env

# Se não existir DATABASE_URL, interrompe a aplicação com erro explicativo
if not DATABASE_URL:                                             # verifica se a variável está vazia ou não definida
    raise RuntimeError(                                          # lança um erro em tempo de importação
        "DATABASE_URL não está configurada. "                    # parte 1 da mensagem
        "Crie um arquivo .env na raiz do projeto com a linha "   # instrução de configuração
        '"DATABASE_URL=postgresql+psycopg2://usuario:senha@host:5432/banco" '  # exemplo de URL
        "ou defina a variável de ambiente no sistema."           # alternativa: configurar direto no sistema operacional
    )

# Cria o "engine" de conexão com o banco, que o SQLAlchemy usa para falar com o PostgreSQL
engine = create_engine(DATABASE_URL)               

# Cria uma fábrica de sessões, que usaremos em cada requisição
SessionLocal = sessionmaker(                                    
    autocommit=False,
    autoflush=False,
    bind=engine
)

# -----------------------------------------------------------
# Configuração de segurança: JWT e hash de senha
# -----------------------------------------------------------

# Chave secreta usada para assinar os tokens JWT (idealmente viria do .env)
SECRET_KEY = os.getenv("SECRET_KEY", "troque-esta-chave-em-producao")  # chave padrão de desenvolvimento
ALGORITHM = "HS256"                                         # algoritmo usado na assinatura dos tokens
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 8                        # tempo de expiração do token (8 horas)

# Contexto de hashing de senhas usando bcrypt
pwd_context = CryptContext(                                 # cria um contexto de criptografia para senhas
    schemes=["pbkdf2_sha256"],                              # usa o algoritmo PBKDF2 com SHA256 (seguro e estável)
    deprecated="auto"                                       # marca outros algoritmos antigos como deprecated
)

# Esquema OAuth2: define que o token será enviado no header Authorization: Bearer <token>
oauth2_scheme = OAuth2PasswordBearer(                       # cria um esquema OAuth2 padrão
    tokenUrl="auth/login"                                   # endpoint que dará o token de acesso
)

# Cria a base para os modelos ORM (tabelas)
Base = declarative_base() 

# Cria uma fábrica de sessões, que usaremos em cada requisição
SessionLocal = sessionmaker(                                    
    autocommit=False,                                            # desabilita autocommit (vamos controlar manualmente)
    autoflush=False,                                             # desabilita autoflush automático
    bind=engine                                                  # vincula este sessionmaker ao nosso engine
)

# Cria a base para os modelos ORM (tabelas)
Base = declarative_base()                                       

# -----------------------------------------------------------
# Modelos de banco (SQLAlchemy) - alinhados com as tabelas
# -----------------------------------------------------------

class Usuario(Base):                                         # classe para tabela "usuarios" (controle de login)
    __tablename__ = "usuarios"                               # nome da tabela no banco

    id = Column(Integer, primary_key=True, index=True)       # identificador único do usuário
    nome = Column(Text, nullable=False)                      # nome completo do usuário
    email = Column(String(255), unique=True, nullable=False) # e-mail (único, obrigatório)
    username = Column(String(50), unique=True, nullable=False)  # login do usuário (único)
    senha_hash = Column(Text, nullable=False)                # hash da senha (nunca armazenar senha pura)
    is_admin = Column(Boolean, nullable=False, default=False)# indica se é administrador (legado, manter para compatibilidade)
    role = Column(String(20), nullable=False, default="avaliador")  # role do usuário: 'admin', 'avaliador', 'comercial'
    precisa_trocar_senha = Column(Boolean, nullable=False, default=True)  # força troca de senha no primeiro login
    ativo = Column(Boolean, nullable=False, default=True)    # se o usuário está ativo ou bloqueado
    criado_em = Column(TIMESTAMP, server_default=func.now()) # data/hora de criação do registro
    atualizado_em = Column(                                  # data/hora da última atualização
        TIMESTAMP,
        server_default=func.now(),                           # valor padrão na criação
        onupdate=func.now()                                  # atualiza automaticamente em alterações
    )

class Avaliacao(Base):                                           # define a classe Avaliacao mapeando a tabela "avaliacoes"
    __tablename__ = "avaliacoes"                                 # nome da tabela no banco

    id = Column(Integer, primary_key=True, index=True)           # coluna id inteira, chave primária, com índice
    usuario_id = Column(Integer, ForeignKey('usuarios.id'), nullable=False)  # usuário criador da avaliação
    usuario = relationship("Usuario", backref="avaliacoes_criadas")  # relacionamento ORM

    codigo_avaliacao = Column(                                   # coluna para o código amigável da avaliação
        String(20),                                              # string de até 20 caracteres (ex.: AVT2025001)
        unique=True,                                             # garante que não haverá dois registros com o mesmo código
        index=True                                               # cria um índice para facilitar buscas e ordenações por código
    )

    # Dados da equipe responsável
    equipe = Column(Text)                                        # equipe responsável (texto livre)
    responsavel_avaliacao = Column(Text)                         # responsável pela avaliação técnica
    #tipo_formulario
    tipo_formulario = Column(String(50))                         # tipo do formulário (ex.: "redes", "infraestrutura", etc.)
    #tipo_formulario
    # Dados do cliente
    cliente_nome = Column(Text, nullable=False)                  # nome do cliente, obrigatório (nullable=False)
    objeto = Column(Text)                                        # objeto da avaliação
    local = Column(Text)                                         # local da instalação/serviço
    data_avaliacao = Column(Date, nullable=False)                # data da avaliação, obrigatória
    contato = Column(Text)                                       # nome do contato do cliente
    email_cliente = Column(Text)                                 # e-mail do cliente

    # Escopo e características gerais
    escopo_texto = Column(Text)                                  # texto com o escopo
    servico_fora_montes_claros = Column(Boolean)                 # True se for fora de Montes Claros
    servico_intermediario = Column(Boolean)                      # True se for intermediário/empreiteira

    # Quantitativo 01 - Patch Panel / Cabeamento UTP
    q1_categoria_cab = Column(String(10))                        # categoria do cabeamento (ex.: CAT5E, CAT6)
    q1_blindado = Column(Boolean)                                # indica se o cabeamento UTP é blindado
    q1_novo_patch_panel = Column(Boolean)                        # indica se será fornecido um novo patch panel
    q1_incluir_guia = Column(Boolean)                            # indica se serão incluídas guias de cabos
    q1_qtd_pontos_rede = Column(Integer)                         # quantidade de pontos de rede previstos
    q1_qtd_cabos = Column(Integer)                               # quantidade de cabos UTP
    q1_qtd_portas_patch_panel = Column(Integer)                  # quantidade de portas do patch panel
    q1_qtd_patch_cords = Column(Integer)                         # quantidade total de patch cords previstos
    q1_marca_cab = Column(String(50))                            # marca do cabeamento UTP (CommScope, Furukawa ou "Outro: <texto>")
    q1_modelo_patch_panel = Column(Text)                         # modelo do patch panel quando houver novo fornecimento (CommScope 24 portas, Furukawa 24 portas, Systimax 24 portas ou "Outro: <texto>")
    q1_qtd_guias_cabos = Column(Integer)                         # quantidade de guias de cabos a instalar
    q1_patch_cords_modelo = Column(Text)                         # modelo/descrição dos patch cords (comprimentos, categoria, etc.)
    q1_patch_cords_cor = Column(String(50))                      # cor ou cores dos patch cords utilizados
    q1_patch_panel_existente_nome = Column(Text)                 # identificação do patch panel existente quando não houver novo fornecimento

    # Quantitativo 02 - Switch
    q2_novo_switch = Column(Boolean)                             # indica se será fornecido um novo switch
    q2_fornecedor_switch = Column(String(20))                    # quem fornece o switch: 'fornecedor_interno' ou 'cliente'
    q2_modelo_switch = Column(Text)                              # modelo do switch (novo ou existente)
    q2_switch_foto_url = Column(Text)                            # URL/caminho da foto do switch
    q2_observacoes = Column(Text)                                # observações gerais sobre o switch

    # Quantitativo 03 – Cabeamento Óptico
    q3_tipo_fibra = Column(String(10))                           # tipo da fibra (ex.: SM, OM1, OM2, OM3, OM4)
    q3_qtd_fibras_por_cabo = Column(Integer)                     # quantidade de fibras por cabo
    q3_tipo_conector = Column(String(10))                        # tipo de conector (ex.: LC, SC)
    q3_novo_dio = Column(Boolean)                                # indica se será fornecido um novo DIO
    q3_caixa_terminacao = Column(Boolean)                        # indica se haverá caixa de terminação
    q3_caixa_emenda = Column(Boolean)                            # indica se haverá caixa de emenda
    q3_qtd_cabos = Column(Integer)                               # quantidade de cabos ópticos
    q3_tamanho_total_m = Column(Numeric(10, 2))                  # metragem total estimada dos cabos ópticos
    q3_qtd_cordoes_opticos = Column(Integer)                     # quantidade de cordões ópticos
    q3_marca_cab_optico = Column(String(50))                     # marca do cabeamento óptico
    q3_modelo_dio = Column(Text)                                 # modelo do DIO utilizado/fornecido
    q3_modelo_cordao_optico = Column(Text)                       # modelo/descrição dos cordões ópticos (comprimento, tipo de conector, etc.)
    q3_observacoes = Column(Text)                                # observações gerais sobre o cabeamento óptico

    # Quantitativo 04 – Equipamentos (Câmeras, NVR/DVR, conversor, GBIC)
    q4_camera = Column(Boolean)                                  # indica se a avaliação envolve câmeras
    q4_nvr_dvr = Column(Boolean)                                 # indica se haverá NVR ou DVR

    q4_camera_nova = Column(Boolean)                             # indica se as câmeras são novas (caso contrário, realocação)
    q4_camera_modelo = Column(Text)                              # modelo das câmeras
    q4_camera_qtd = Column(Integer)                              # quantidade de câmeras do modelo indicado
    q4_camera_fornecedor = Column(String(20))                    # quem fornece as câmeras: 'fornecedor_interno' ou 'cliente'
    q4_nvr_dvr_modelo = Column(Text)                             # modelo do NVR ou DVR

    # Quantitativo 05 – Infraestrutura
    q5_nova_eletrocalha = Column(Boolean)                        # indica se haverá nova eletrocalha
    q5_novo_eletroduto = Column(Boolean)                         # indica se haverá novo eletroduto
    q5_novo_rack = Column(Boolean)                               # indica se haverá novo rack
    q5_instalacao_eletrica = Column(Boolean)                     # indica se haverá adequação/instalação elétrica
    q5_nobreak = Column(Boolean)                                 # indica se haverá nobreak
    q5_serralheria = Column(Boolean)                             # indica se haverá serviços de serralheria
    q5_eletrocalha_modelo = Column(Text)                         # modelo/descrição da eletrocalha
    q5_eletrocalha_qtd = Column(Integer)                         # quantidade de eletrocalhas
    q5_eletroduto_modelo = Column(Text)                          # modelo/descrição do eletroduto
    q5_eletroduto_qtd = Column(Integer)                          # quantidade de eletrodutos
    q5_rack_modelo = Column(Text)                                # modelo/descrição do rack
    q5_rack_qtd = Column(Integer)                                # quantidade de racks
    q5_nobreak_modelo = Column(Text)                             # modelo/descrição do nobreak
    q5_nobreak_qtd = Column(Integer)                             # quantidade de nobreaks
    q5_serralheria_descricao = Column(Text)                      # descrição detalhada da serralheria necessária
    q5_instalacao_eletrica_obs = Column(Text)                    # observações adicionais sobre a instalação elétrica

    # Quantitativo 09 - Análise de Painel de Automação (Controle de Acesso)
    q9_tensao_fonte = Column(String(50))                         # tensão da fonte (12V, 24V, ou outro)
    q9_tensao_fonte_outro = Column(Text)                         # valor customizado se "outro"
    q9_novo_cabeamento = Column(Boolean)                         # indica se será fornecido novo cabeamento
    q9_tipo_cabeamento = Column(String(50))                      # tipo do cabeamento (7 vias, 14 vias, outro)
    q9_tipo_cabeamento_outro = Column(Text)                      # valor customizado se "outro"
    q9_quantidade_metros = Column(Numeric(10, 2))                # quantidade de metros do cabeamento

    # Quantitativo 10 – Portas (Controle de Acesso)
    q10_tipo_porta = Column(String(20))                          # tipo de porta (pivotante ou deslizante)
    q10_servo_motor = Column(Boolean)                            # servo motor (apenas para pivotante)
    q10_servo_motor_qtd = Column(Integer)                        # quantidade de servo motores
    q10_ponto_eletrico_novo = Column(Boolean)                    # precisa de ponto elétrico novo
    q10_suporte_eletroimã = Column(Boolean)                      # suporte para eletroímã/fechadura eletrônica
    q10_suporte_eletroimã_qtd = Column(Integer)                  # quantidade de suportes para eletroímã
    q10_botoeira_saida = Column(Boolean)                         # botoeira de saída
    q10_botoeira_saida_qtd = Column(Integer)                     # quantidade de botoeiras de saída
    q10_botoeira_emergencia = Column(Boolean)                    # botoeira de emergência
    q10_botoeira_emergencia_qtd = Column(Integer)                # quantidade de botoeiras de emergência
    q10_leitor_cartao = Column(Boolean)                          # leitor de cartão
    q10_leitor_cartao_qtd = Column(Integer)                      # quantidade de leitores de cartão
    q10_leitor_facial = Column(Boolean)                          # leitor facial
    q10_leitor_facial_qtd = Column(Integer)                      # quantidade de leitores faciais
    q10_sensor_presenca = Column(Boolean)                        # sensor de presença
    q10_sensor_presenca_qtd = Column(Integer)                    # quantidade de sensores de presença
    q10_sensor_barreira = Column(Boolean)                        # sensor de barreira/segurança
    q10_sensor_barreira_qtd = Column(Integer)                    # quantidade de sensores de barreira
    q9_observacoes = Column(Text)                                # observações sobre painel de automação
    q10_observacoes = Column(Text)                               # observações sobre portas

    # Quantitativo 06 – Catracas, Torniquetes e Cancelas
    q6_modelo = Column(String(255))                              # modelo do equipamento
    q6_quantidade = Column(Integer)                              # quantidade de catracas/torniquetes/cancelas
    q6_leitor_facial = Column(Boolean)                           # leitor facial
    q6_leitor_facial_qtd = Column(Integer)                       # quantidade de leitores faciais
    q6_suporte_leitor_facial = Column(Boolean)                   # suporte para leitor facial
    q6_suporte_leitor_facial_qtd = Column(Integer)               # quantidade de suportes para leitor facial
    q6_leitor_cartao = Column(Boolean)                           # leitor de cartão
    q6_leitor_cartao_qtd = Column(Integer)                       # quantidade de leitores de cartão
    q6_suporte_leitor_cartao = Column(Boolean)                   # suporte para leitor de cartão
    q6_suporte_leitor_cartao_qtd = Column(Integer)               # quantidade de suportes para leitor de cartão
    q6_licenca_software = Column(Boolean)                        # licença do software
    q6_no_break = Column(Boolean)                                # no break
    q6_servidor = Column(Boolean)                                # servidor
    q6_observacoes = Column(Text)                                # observações sobre catracas/torniquetes/cancelas

    # Quantitativo 10 - Novos campos para Portas (Expansão)
    # Eletroímã/Fechadura (novo grupo)
    q10_eletroimã_fechadura = Column(Boolean)                    # precisa de eletroímã/fechadura
    q10_eletroimã_fechadura_modelo = Column(String(255))         # modelo do eletroímã/fechadura
    q10_eletroimã_fechadura_qtd = Column(Integer)                # quantidade de eletroímãs/fechaduras

    # Mola Hidráulica (novo grupo)
    q10_mola_hidraulica = Column(Boolean)                        # precisa de mola hidráulica
    q10_mola_hidraulica_tipo = Column(String(50))                # tipo de mola: piso ou aérea
    q10_mola_hidraulica_qtd = Column(Integer)                    # quantidade de molas hidráulicas

    # Proteção para botoeira de emergência (campo direto)
    q10_protecao_botoeira_emergencia_qtd = Column(Integer)       # quantidade de proteções para botoeira emergência

    # Modelos dos campos Q10 existentes (6 campos)
    q10_botoeira_saida_modelo = Column(String(255))              # modelo da botoeira de saída
    q10_botoeira_emergencia_modelo = Column(String(255))         # modelo da botoeira de emergência
    q10_leitor_cartao_modelo = Column(String(255))               # modelo do leitor de cartão
    q10_leitor_facial_modelo = Column(String(255))               # modelo do leitor facial
    q10_sensor_presenca_modelo = Column(String(255))             # modelo do sensor de presença
    q10_sensor_barreira_modelo = Column(String(255))             # modelo do sensor de barreira/segurança

    # Quantitativo 06 - Expansão de campos (No-break e Servidor)
    q6_no_break_modelo = Column(String(255))                     # modelo do no-break
    q6_no_break_qtd = Column(Integer)                            # quantidade de no-breaks
    q6_servidor_modelo = Column(String(255))                     # modelo do servidor
    q6_servidor_qtd = Column(Integer)                            # quantidade de servidores

    # Localização / Referências
    localizacao_imagem1_url = Column(Text)                       # URL da primeira imagem
    localizacao_imagem2_url = Column(Text)                       # URL da segunda imagem

    # Pré-requisitos
    pre_trabalho_altura = Column(Boolean)                        # trabalho em altura
    pre_plataforma = Column(Boolean)                             # precisa de plataforma
    pre_plataforma_modelo = Column(Text)                         # modelo da plataforma
    pre_plataforma_dias = Column(Integer)                        # dias de uso da plataforma
    pre_fora_horario_comercial = Column(Boolean)                 # fora do horário comercial
    pre_veiculo_empresa = Column(Boolean)                       # uso de veículo da empresa
    pre_container_materiais = Column(Boolean)                    # container de materiais

        # Novos campos - horas trabalhadas por função (dias normais)
    encarregado_dias = Column(Integer)                          # quantidade de dias trabalhados pelo encarregado (tabela 4)
    instalador_dias = Column(Integer)                           # quantidade de dias trabalhados pelo instalador
    auxiliar_dias = Column(Integer)                             # quantidade de dias trabalhados pelo auxiliar
    tecnico_de_instalacao_dias = Column(Integer)                # quantidade de dias do técnico de instalação
    tecnico_em_seguranca_dias = Column(Integer)                 # quantidade de dias do técnico em segurança eletrônica

    # Novos campos - horas extras por função
    encarregado_hora_extra = Column(Integer)                    # quantidade de horas extras do encarregado
    instalador_hora_extra = Column(Integer)                     # quantidade de horas extras do instalador
    auxiliar_hora_extra = Column(Integer)                       # quantidade de horas extras do auxiliar
    tecnico_de_instalacao_hora_extra = Column(Integer)          # horas extras do técnico de instalação
    tecnico_em_seguranca_hora_extra = Column(Integer)           # horas extras do técnico em segurança

    # Novos campos - trabalho em domingos/feriados por função
    encarregado_trabalho_domingo = Column(Integer)              # horas de trabalho do encarregado em domingos/feriados
    instalador_trabalho_domingo = Column(Integer)               # horas de trabalho do instalador em domingos/feriados
    auxiliar_trabalho_domingo = Column(Integer)                 # horas de trabalho do auxiliar em domingos/feriados
    tecnico_de_instalacao_trabalho_domingo = Column(Integer)    # horas de trabalho do técnico de instalação em domingos/feriados
    tecnico_em_seguranca_trabalho_domingo = Column(Integer)     # horas de trabalho do técnico em segurança em domingos/feriados

    # Novos campos - alimentação (Tabela 5)
    almoco_qtd = Column(Integer)                                # quantidade de almoços previstos para a equipe
    lanche_qtd = Column(Integer)                                # quantidade de lanches previstos para a equipe

    # Novos campos - cronograma e prazos (equivalentes aos antigos campos 'prazo_*')
    cronograma_execucao = Column(Boolean)                       # indica se haverá cronograma de execução da obra (sim/não)
    dias_instalacao = Column(Integer)                           # quantidade total de dias previstos para instalação
    as_built = Column(Boolean)                                  # indica se haverá entrega de As Built (sim/não)
    dias_entrega_relatorio = Column(Integer)                    # dias previstos para entrega de relatório/relatório de obra
    art = Column(Boolean)                                       # indica se haverá ART associada ao serviço (sim/não)

    # Campos comerciais (somente admin/comercial podem preencher)
    pedido_compra = Column(String(100))                          # número do pedido de compra do cliente
    numero_proposta = Column(String(100))                        # número da proposta comercial

    # Status e controle
    status = Column(String(30), nullable=False, default="aberto")# status da avaliação com valor padrão "aberto"
    criado_em = Column(TIMESTAMP, server_default=func.now())     # data/hora de criação com valor padrão do servidor
    atualizado_em = Column(TIMESTAMP, server_default=func.now(),# data/hora de atualização com valor padrão
                           onupdate=func.now())                  # atualiza automaticamente em alterações

    # Relacionamentos ORM
    equipamentos = relationship("AvaliacaoEquipamento",          # relacionamento 1:N com equipamentos
                                back_populates="avaliacao",      # nome do atributo inverso na classe filha
                                cascade="all, delete-orphan")    # apaga filhos ao apagar a avaliação
    
    imagens = relationship(                                      # relacionamento 1:N com as imagens associadas à avaliação
        "AvaliacaoImagem",                                       # nome da classe filha que representa a tabela de imagens
        back_populates="avaliacao",                              # atributo definido na classe AvaliacaoImagem apontando de volta para Avaliacao
        cascade="all, delete-orphan"                             # ao apagar a avaliação, apaga também todas as imagens vinculadas
    )                                                            # fim da definição do relacionamento de imagens

    outros_recursos = relationship("AvaliacaoOutroRecurso",      # relacionamento 1:N com outros recursos
                                   back_populates="avaliacao",   # atributo inverso
                                   cascade="all, delete-orphan") # apaga filhos ao apagar a avaliação

    materiais_painel = relationship("AvaliacaoMaterialPainel",   # relacionamento 1:N com materiais do painel
                                    back_populates="avaliacao",  # atributo inverso
                                    cascade="all, delete-orphan") # apaga filhos ao apagar a avaliação

    auditoria = relationship("AvaliacaoAuditoria",               # relacionamento 1:N com auditoria
                             back_populates="avaliacao",         # atributo inverso
                             cascade="all, delete-orphan")       # apaga logs ao apagar a avaliação


class AvaliacaoEquipamento(Base):                                # classe para tabela "avaliacoes_equipamentos"
    __tablename__ = "avaliacoes_equipamentos"                    # nome da tabela

    id = Column(Integer, primary_key=True, index=True)           # id do equipamento (chave primária)
    avaliacao_id = Column(Integer,                               # id da avaliação associada
                          ForeignKey("avaliacoes.id"),           # chave estrangeira apontando para avaliacoes.id
                          nullable=False)                        # obrigatório

    equipamento = Column(Text, nullable=False)                   # nome do equipamento (obrigatório)
    modelo = Column(Text)                                        # modelo do equipamento
    quantidade = Column(Integer, nullable=False)                 # quantidade (obrigatório)
    fabricante = Column(Text)                                    # fabricante do equipamento

    avaliacao = relationship("Avaliacao",                        # relacionamento de volta com Avaliacao
                             back_populates="equipamentos")      # conecta com o atributo equipamentos em Avaliacao

class AvaliacaoImagem(Base):                                     # classe ORM que representa a tabela "avaliacoes_imagens"
    __tablename__ = "avaliacoes_imagens"                         # nome da tabela no banco de dados

    id = Column(Integer, primary_key=True, index=True)           # identificador único da imagem (chave primária)
    avaliacao_id = Column(                                       # coluna que guarda o id da avaliação dona da imagem
        Integer,                                                 # tipo inteiro, compatível com a chave primária de avaliacoes
        ForeignKey("avaliacoes.id"),                             # chave estrangeira apontando para avaliacoes.id
        nullable=False                                           # não pode ser nulo, toda imagem pertence a uma avaliação
    )
    contexto = Column(String(50), nullable=False)                # contexto da imagem (ex.: 'switch', 'localizacao', 'q4_cameras', etc.)
    ordem = Column(Integer, nullable=False)                      # ordem de exibição da imagem dentro do contexto
    url = Column(Text, nullable=False)                           # URL pública ou caminho da imagem salva em storage
    descricao = Column(Text)                                     # descrição/opcional para documentar o que a imagem representa

    avaliacao = relationship(                                    # define o relacionamento de volta com a avaliação
        "Avaliacao",                                             # nome da classe pai (Avaliacão)
        back_populates="imagens"                                 # conecta com o atributo "imagens" definido na classe Avaliacao
    )                                                            # fim da definição do relacionamento AvaliacaoImagem -> Avaliacao

class AvaliacaoOutroRecurso(Base):                               # classe para tabela "avaliacoes_outros_recursos"
    __tablename__ = "avaliacoes_outros_recursos"                 # nome da tabela

    id = Column(Integer, primary_key=True, index=True)           # id do recurso (chave primária)
    avaliacao_id = Column(Integer,                               # id da avaliação associada
                          ForeignKey("avaliacoes.id"),           # chave estrangeira para avaliacoes.id
                          nullable=False)                        # obrigatório

    descricao = Column(Text, nullable=False)                     # descrição do recurso (ex.: Almoço, Lanche)
    quantidade = Column(Integer, nullable=False)                 # quantidade do recurso

    avaliacao = relationship("Avaliacao",                        # relacionamento com Avaliacao
                             back_populates="outros_recursos")   # conecta com o atributo outros_recursos


class AvaliacaoMaterialPainel(Base):                             # classe para tabela "avaliacoes_materiais_painel"
    __tablename__ = "avaliacoes_materiais_painel"                # nome da tabela

    id = Column(Integer, primary_key=True, index=True)           # id do material (chave primária)
    avaliacao_id = Column(Integer,                               # id da avaliação associada
                          ForeignKey("avaliacoes.id"),           # chave estrangeira para avaliacoes.id
                          nullable=False)                        # obrigatório

    equipamento = Column(Text, nullable=False)                   # nome do equipamento/componente (bornes, módulos, etc.)
    modelo = Column(Text)                                        # modelo do equipamento
    quantidade = Column(Integer, nullable=False)                 # quantidade (obrigatório)
    fabricante = Column(Text)                                    # fabricante do equipamento

    avaliacao = relationship("Avaliacao",                        # relacionamento com Avaliacao
                             back_populates="materiais_painel")  # conecta com o atributo materiais_painel


class AvaliacaoAuditoria(Base):                                  # classe para tabela "avaliacoes_auditoria"
    __tablename__ = "avaliacoes_auditoria"                       # nome da tabela

    id = Column(Integer, primary_key=True, index=True)           # id do registro de auditoria
    avaliacao_id = Column(Integer,                               # id da avaliação associada
                          ForeignKey("avaliacoes.id"),           # chave estrangeira
                          nullable=False)                        # obrigatório

    usuario = Column(String(255))                                # usuário que realizou a ação (texto livre por enquanto)
    acao = Column(String(50), nullable=False)                    # tipo de ação: CRIAR, EDITAR, EXCLUIR, etc.
    detalhes = Column(Text)                                      # detalhes da ação (JSON/texto)
    data_hora = Column(TIMESTAMP, server_default=func.now())     # data/hora do evento de auditoria

    avaliacao = relationship("Avaliacao",                        # relacionamento com Avaliacao
                             back_populates="auditoria")         # conecta com o atributo auditoria em Avaliacao

class UsuarioAuditoria(Base):                                       # classe que representa a tabela de auditoria de ações em usuários
    __tablename__ = "usuarios_auditoria"                            # nome da tabela no banco de dados

    id = Column(Integer, primary_key=True, index=True)              # identificador único de cada registro de auditoria
    usuario_alvo_id = Column(                                       # id do usuário que sofreu a ação (ex.: teve senha resetada)
        Integer,                                                    # tipo inteiro
        ForeignKey("usuarios.id"),                                  # chave estrangeira para a tabela usuarios
        nullable=False                                              # obrigatório: sempre teremos um usuário alvo
    )
    usuario_acao_id = Column(                                       # id do usuário que executou a ação (ex.: o admin)
        Integer,                                                    # tipo inteiro
        ForeignKey("usuarios.id"),                                  # também referencia a tabela usuarios
        nullable=True                                               # pode ser nulo (ex.: ações automáticas do sistema)
    )
    acao = Column(String(50), nullable=False)                        # tipo de ação realizada (CRIAR_USUARIO, DESATIVAR_USUARIO, RESET_SENHA, TROCAR_SENHA, etc.)
    detalhes = Column(Text)                                         # campo livre para guardar detalhes em texto/JSON
    data_hora = Column(                                             # data e hora em que a ação ocorreu
        TIMESTAMP,                                                  # tipo timestamp
        server_default=func.now()                                   # preenchido automaticamente pelo banco com o horário atual
    )

    usuario_alvo = relationship(                                    # relacionamento ORM com o usuário alvo da ação
        "Usuario",                                                  # relaciona com a classe Usuario
        foreign_keys=[usuario_alvo_id]                              # especifica que usa a coluna usuario_alvo_id como chave
    )
    usuario_acao = relationship(                                    # relacionamento ORM com o usuário que executou a ação
        "Usuario",                                                  # também relaciona com a classe Usuario
        foreign_keys=[usuario_acao_id]                              # especifica que usa a coluna usuario_acao_id como chave
    )

def registrar_auditoria_usuario(                                    # função de ajuda para registrar uma linha na auditoria de usuários
    db: Session,                                                    # sessão de banco de dados atual
    usuario_alvo_id: int,                                           # id do usuário que sofreu a ação
    acao: str,                                                      # código da ação realizada (ex.: "CRIAR_USUARIO")
    detalhes: Optional[str] = None,                                 # detalhes adicionais em texto/JSON (opcional)
    usuario_responsavel: Optional[Usuario] = None                   # usuário que executou a ação (opcional, ex.: admin)
) -> None:                                                          # função não retorna nada
    log = UsuarioAuditoria(                                         # cria um novo objeto de auditoria
        usuario_alvo_id=usuario_alvo_id,                            # seta o id do usuário alvo
        usuario_acao_id=usuario_responsavel.id                      # usa o id do usuário responsável se for informado
        if usuario_responsavel                                     # verifica se foi enviado um usuário responsável
        else None,                                                 # caso contrário, deixa como None
        acao=acao,                                                  # registra o tipo de ação
        detalhes=detalhes                                           # guarda os detalhes adicionais
    )
    db.add(log)                                                     # adiciona o registro de auditoria na sessão (commit será feito na rota)

# -----------------------------------------------------------
# Funções auxiliares para senha e token JWT
# -----------------------------------------------------------

def verificar_senha(senha_plana: str, senha_hash: str) -> bool:  # função para comparar senha digitada com o hash salvo
    return pwd_context.verify(senha_plana, senha_hash)           # usa o contexto do passlib para validar

def gerar_hash_senha(senha_plana: str) -> str:                   # função para gerar o hash de uma senha
    return pwd_context.hash(senha_plana)                         # retorna o hash bcrypt da senha

def gerar_senha_temporaria(tamanho: int = 10) -> str:
    alfabeto = string.ascii_letters + string.digits  
    return "".join(                                              # junta os caracteres escolhidos em uma única string
        secrets.choice(alfabeto) 
        for _ in range(tamanho)                                  # repete o processo 'tamanho' vezes
    )                                                            # retorna a senha gerada

def gerar_codigo_avaliacao(                                     # função para gerar o código amigável da avaliação
    db: Session,                                                 # recebe a sessão de banco para consultar avaliações existentes
    data_avaliacao: Optional[date]                              # recebe a data da avaliação (pode ser None)
) -> str:                                                        # retorna uma string com o código gerado
    if isinstance(data_avaliacao, date):                         # verifica se a data recebida é um objeto date válido
        ano_referencia = data_avaliacao.year                     # usa o ano da própria data da avaliação como referência
    else:                                                        # caso a data venha None ou em formato inesperado
        ano_referencia = date.today().year                       # usa o ano atual do servidor como fallback

    prefixo = f"AVT{ano_referencia}"                             # monta o prefixo fixo com AVT + ano (ex.: AVT2025)

    ultimo = (                                                   # inicia a busca pela última avaliação com esse prefixo
        db.query(Avaliacao)                                      # abre uma consulta na tabela de Avaliacoes
        .filter(                                                 # aplica um filtro na consulta
            Avaliacao.codigo_avaliacao.like(f"{prefixo}%")       # pega apenas códigos que comecem com o prefixo do ano
        )
        .order_by(Avaliacao.codigo_avaliacao.desc())             # ordena de forma decrescente pelo código (mais recente primeiro)
        .first()                                                 # pega apenas o primeiro resultado (ou None, se não houver)
    )

    proximo_numero = 1                                           # valor padrão para o próximo número sequencial (001)

    if ultimo and ultimo.codigo_avaliacao:                       # se encontramos um registro com código definido
        sufixo = ultimo.codigo_avaliacao[-3:]                    # pega os últimos 3 caracteres do código (parte numérica)
        try:                                                     # tenta converter o sufixo em número
            proximo_numero = int(sufixo) + 1                     # incrementa o número encontrado para gerar o próximo da sequência
        except ValueError:                                       # se o sufixo não for um número válido
            proximo_numero = 1                                   # volta para 1 como fallback seguro

    codigo = f"{prefixo}{proximo_numero:03d}"                    # monta o código final com sufixo de 3 dígitos, preenchido com zeros

    return codigo                                                # devolve a string gerada (ex.: AVT2025001)

def criar_token_acesso(dados: dict,                              # função para criar um token JWT
                       expira_em: Optional[timedelta] = None     # parâmetro opcional com tempo de expiração
                       ) -> str:                                 # retorna uma string com o token
    to_encode = dados.copy()                                     # copia o dicionário de dados (payload)
    if expira_em:                                                # se um delta de expiração foi passado
        expire = datetime.utcnow() + expira_em                   # calcula a data de expiração
    else:                                                        # se não foi passado
        expire = datetime.utcnow() + timedelta(                  # usa tempo padrão definido em minutos
            minutes=ACCESS_TOKEN_EXPIRE_MINUTES
        )
    to_encode.update({"exp": expire})                            # adiciona campo "exp" (expiração) ao payload
    encoded_jwt = jwt.encode(                                    # gera o token JWT
        to_encode,                                               # payload com dados + expiração
        SECRET_KEY,                                              # chave secreta usada na assinatura
        algorithm=ALGORITHM                                     # algoritmo definido anteriormente
    )
    return encoded_jwt                                           # devolve o token JWT assinado

# -----------------------------------------------------------
# Funções para buscar e autenticar usuários
# -----------------------------------------------------------

def obter_usuario_por_username(db: Session,                      # função para buscar usuário pelo username
                               username: str                     # username (login) a ser pesquisado
                               ) -> Optional[Usuario]:           # retorna um Usuario ou None
    return db.query(Usuario).filter(                             # monta query na tabela usuarios
        Usuario.username == username,                            # filtra pelo username informado
        Usuario.ativo == True                                    # garante que o usuário esteja ativo
    ).first()                                                    # pega o primeiro resultado (ou None)

def autenticar_usuario(db: Session,                              # função que valida login/senha
                       username: str,                            # login informado
                       senha_plana: str                          # senha digitada pelo usuário
                       ) -> Optional[Usuario]:                   # retorna o usuário se der certo, ou None se falhar
    usuario = obter_usuario_por_username(db, username)           # busca o usuário pelo login
    if not usuario:                                              # se não encontrou
        return None                                              # retorna None (falha de autenticação)
    if not verificar_senha(senha_plana, usuario.senha_hash):     # se a senha não confere com o hash
        return None                                              # falha de autenticação
    return usuario                                               # autenticação OK, retorna o usuário

# -----------------------------------------------------------
# Dependência de sessão de banco para usar nas rotas
# -----------------------------------------------------------
def get_db() -> Session:                                         # função de dependência que fornece uma sessão de banco
    db = SessionLocal()                                          # cria uma nova sessão
    try:
        yield db                                                  # entrega a sessão para quem chamou
    finally:
        db.close()                                               # fecha a sessão depois do uso

# Dependência para obter usuário logado a partir do token JWT
async def obter_usuario_atual(                                   # função assíncrona para pegar o user do token
    token: str = Depends(oauth2_scheme),                         # token obtido automaticamente do header Authorization
    db: Session = Depends(get_db)                                # sessão de banco injetada pelo FastAPI
) -> Usuario:                                                    # retorna um objeto Usuario
    cred_exc = HTTPException(                                    # exceção padrão para problema de credenciais
        status_code=401,                                         # código HTTP 401 - não autorizado
        detail="Não foi possível validar as credenciais.",       # mensagem genérica de erro
        headers={"WWW-Authenticate": "Bearer"}                   # indica que usamos esquema Bearer
    )
    try:
        payload = jwt.decode(                                    # tenta decodificar o token JWT
            token,                                               # token recebido
            SECRET_KEY,                                          # chave secreta usada na assinatura
            algorithms=[ALGORITHM]                               # algoritmo esperado
        )
        username: str = payload.get("sub")                       # pega o campo "sub" (subject) do payload
        if username is None:                                     # se não tiver username
            raise cred_exc                                       # lança erro de credenciais inválidas
    except JWTError:                                             # se ocorrer erro ao decodificar o token
        raise cred_exc                                           # lança erro de credenciais inválidas

    usuario = obter_usuario_por_username(db, username)           # busca o usuário no banco a partir do username
    if usuario is None:                                          # se não encontrar
        raise cred_exc                                           # lança erro de credenciais
    if not usuario.ativo:                                        # se o usuário estiver inativo/bloqueado
        raise HTTPException(                                     # lança erro 403 (proibido)
            status_code=403,
            detail="Usuário inativo."
        )
    return usuario                                               # retorna o usuário válido

# Alias para compatibilidade com Depends(get_current_user)
get_current_user = obter_usuario_atual

# Dependência para garantir que o usuário atual é administrador
async def obter_admin_atual(                                     # função para validar se o usuário logado é admin
    usuario: Usuario = Depends(obter_usuario_atual)              # obtém o usuário atual via token
) -> Usuario:                                                    # retorna o mesmo usuário se for admin
    if not usuario.is_admin:                                     # se não for administrador
        raise HTTPException(                                     # lança erro 403 (proibido)
            status_code=403,
            detail="Apenas administradores podem realizar esta ação."
        )
    return usuario                                               # se for admin, retorna o usuário

# -----------------------------------------------------------
# Criação das tabelas no banco (se ainda não existirem)
# -----------------------------------------------------------
Base.metadata.create_all(bind=engine)                            # cria todas as tabelas definidas acima no banco

# -----------------------------------------------------------
# Bootstrap: cria usuário admin padrão se ainda não existir
# -----------------------------------------------------------

def criar_admin_se_nao_existir() -> None:                       # função que garante um admin padrão no banco
    db = SessionLocal()                                         # abre uma sessão de banco
    try:
        admin = db.query(Usuario).filter(                       # procura usuário com username "admin"
            Usuario.username == "admin"
        ).first()   
        if not admin:                                           # se não existir
            admin = Usuario(                                    # cria novo objeto Usuario
                nome="Administrador",                           # nome padrão
                email="miguelribeiro.dev1@gmail.com",                   # e-mail padrão
                username="admin",                               # login padrão
                senha_hash=gerar_hash_senha("admin123"),        # senha padrão "admin123" (hash)
                is_admin=True,                                  # marca como administrador
                role="admin",                                   # role admin
                precisa_trocar_senha=True                       # obriga troca de senha no primeiro login
            )
            db.add(admin)                                       # adiciona o admin à sessão
            db.commit()                                         # grava no banco
            print("Usuário admin criado com senha 'admin123'. Altere assim que possível.")  # log simples no console
    finally:
        db.close()                                              # garante o fechamento da sessão

criar_admin_se_nao_existir()                                    # chama a função na inicialização da aplicação

# -----------------------------------------------------------
# Schemas Pydantic (entrada/saída)
# -----------------------------------------------------------

# -----------------------------------------------------------
# Schemas Pydantic para autenticação e usuários
# -----------------------------------------------------------

class TokenSchema(BaseModel):                                   # schema de resposta do endpoint de login
    access_token: str                                           # token JWT gerado
    token_type: str = "bearer"                                  # tipo do token (sempre "bearer")

class UsuarioBaseSchema(BaseModel):                             # schema base com dados públicos do usuário
    id: int                                                     # identificador do usuário
    nome: str                                                   # nome completo do usuário
    email: str                                                  # e-mail principal do usuário
    username: str                                               # login usado para autenticação
    is_admin: bool                                              # indica se o usuário é administrador (legado)
    role: str = "avaliador"                                   # role do usuário: 'admin', 'avaliador', 'comercial'
    precisa_trocar_senha: bool                                  # indica se o usuário ainda precisa trocar a senha inicial
    ativo: bool                                                 # indica se o usuário está ativo ou bloqueado

    class Config:                                               # configurações do Pydantic
        orm_mode = True                                         # permite criar o schema a partir de objetos ORM

class UsuarioCreateSchema(BaseModel):                           # schema para criação de usuário (apenas admins podem chamar)
    nome: str                                                   # nome completo do usuário
    email: str                                                  # e-mail do usuário
    username: str                                               # login desejado (login de acesso)
    senha: str                                                  # senha inicial (será convertida em hash no backend)
    is_admin: bool = False                                      # indica se o novo usuário será administrador (legado, manter compatibilidade)
    role: str = "avaliador"                                   # role do usuário: 'admin', 'avaliador', 'comercial'

class UsuarioStatusUpdateSchema(BaseModel):                      # schema usado para ativar ou desativar um usuário
    ativo: bool                                                  # indica se o usuário deve ficar ativo (True) ou inativo (False)

class UsuarioRoleUpdateSchema(BaseModel):                       # schema para alterar o role de um usuário
    role: str                                                    # novo role: 'admin', 'avaliador' ou 'comercial'

class UsuarioMeSchema(UsuarioBaseSchema):                       # schema para retornar dados do usuário logado
    pass                                                        # herda tudo de UsuarioBaseSchema sem alterações

class TrocarSenhaSchema(BaseModel):                             # schema para alteração de senha pelo próprio usuário
    senha_atual: str                                            # senha atual digitada
    nova_senha: str                                             # nova senha desejada

class UploadImagemResponseSchema(BaseModel):  # schema de resposta da rota de upload de imagem
    avaliacao_id: int  # id da avaliação que teve o campo de imagem atualizado
    campo: str  # nome do campo atualizado (localizacao_imagem1_url ou localizacao_imagem2_url)
    url: str  # URL pública (relativa) para acessar a imagem salva via /uploads

class MaterialPainelBaseSchema(BaseModel):                         # schema base para materiais do painel de automação
    equipamento: str = Field(                                      # nome do equipamento/componente
        ...,                                                       # obrigatório
        description="Nome do equipamento (ex.: Borne, Módulo, Relé)"  # descrição para o Swagger
    )
    modelo: Optional[str] = Field(                                 # modelo do equipamento
        None,                                                      # opcional
        description="Modelo do equipamento"                        # descrição para o Swagger
    )
    quantidade: int = Field(                                       # quantidade do equipamento
        ...,                                                       # obrigatório
        ge=1,                                                      # mínimo 1
        description="Quantidade do equipamento"                    # descrição para o Swagger
    )
    fabricante: Optional[str] = Field(                             # fabricante do equipamento
        None,                                                      # opcional
        description="Fabricante do equipamento"                    # descrição para o Swagger
    )

    class Config:                                                  # configurações do Pydantic
        orm_mode = True                                            # permite converter a partir de objetos ORM

class MaterialPainelOutSchema(MaterialPainelBaseSchema):           # schema de saída para material do painel
    id: int = Field(..., description="ID do material")            # identificador único do material
    avaliacao_id: int = Field(..., description="ID da avaliação") # id da avaliação relacionada

class AvaliacaoBaseSchema(BaseModel):                            # schema base com campos principais
    cliente_nome: str = Field(..., description="Nome do cliente")# nome do cliente, obrigatório
    usuario_id: Optional[int] = Field(None, description="ID do usuário criador da avaliação")
    data_avaliacao: date = Field(  # data da avaliação em string, opcional (iremos converter manualmente)
        None,  # se None, mantém a data atual
        description="Data da avaliação no formato YYYY-MM-DD"  # formato esperado ao atualizar
    )
    local: Optional[str] = Field(                                # campo opcional para o local da instalação
        None,                                                    # valor padrão None (não obrigatório)
        description="Local da instalação"                        # descrição exibida na documentação
    )
    objeto: Optional[str] = Field(                               # campo opcional para o objeto da avaliação
        None,                                                    # valor padrão None (não obrigatório)
        description="Objeto da avaliação"                        # descrição exibida na documentação
    )
    status: Optional[str] = Field(                               # campo opcional para o status da avaliação
        "aberto",                                                # valor padrão "aberto" se não for enviado
        description="Status da avaliação"                        # descrição exibida na documentação
    )
    pedido_compra: Optional[str] = Field(                        # pedido de compra do cliente
        None,                                                    # valor padrão None
        description="Número do pedido de compra (somente admin/comercial)"
    )
    numero_proposta: Optional[str] = Field(                      # número da proposta comercial
        None,                                                    # valor padrão None
        description="Número da proposta comercial (somente admin/comercial)"
    )
    #tipo_formulario
    tipo_formulario: Optional[str] = Field(                      # novo campo para tipo de formulário
        None,                                                    # None = não informado / legado
        description="Tipo do formulário (ex.: redes, infraestrutura, etc.)"  # descrição para Swagger
    )
    #tipo_formulario
    class Config:                                                # configurações do Pydantic
        orm_mode = True                                          # permite criar instâncias a partir de modelos ORM


class AvaliacaoCreateSchema(AvaliacaoBaseSchema):  # Schema usado para criação de uma nova avaliação (entrada vinda do front)
    equipe: Optional[str] = None  # (texto) Nome da equipe responsável pela avaliação
    responsavel_avaliacao: Optional[str] = None  # (texto) Nome do responsável técnico/comercial pela avaliação
    contato: Optional[str] = None  # (texto) Nome da pessoa de contato do cliente
    email_cliente: Optional[str] = None  # (texto) E-mail do cliente para envio de proposta/relatório
    escopo_texto: Optional[str] = None  # (texto) Descrição resumida do escopo da avaliação

    servico_fora_montes_claros: Optional[bool] = None  # (sim/não) Indica se o serviço será fora de Montes Claros
    servico_intermediario: Optional[bool] = None  # (sim/não) Indica se haverá empresa intermediária/empreiteira

    # ---------------- Quantitativo 01 - Patch Panel / Cabeamento UTP ----------------
    q1_categoria_cab: Optional[str] = None  # (texto / opções Cat5e, Cat6, Cat6a) Categoria de cabeamento estruturado
    q1_blindado: Optional[bool] = None  # (sim/não) Se o cabeamento UTP será blindado
    q1_novo_patch_panel: Optional[bool] = None  # (sim/não) Se será fornecido patch panel novo
    q1_incluir_guia: Optional[bool] = None  # (sim/não) Se deve incluir guia de passagem / duto auxiliar
    q1_qtd_pontos_rede: Optional[int] = None  # (número) Quantidade de pontos de rede (dados)
    q1_qtd_cabos: Optional[int] = None  # (número) Quantidade de cabos de rede necessários
    q1_qtd_portas_patch_panel: Optional[int] = None  # (número) Quantidade de portas no patch panel
    q1_qtd_patch_cords: Optional[int] = None  # (número) Quantidade de patch cords (cordões de rede)
    q1_marca_cab: Optional[str] = None  # (texto) Marca do cabeamento UTP (CommScope, Furukawa ou "Outro: <texto>")    q1_modelo_patch_panel: Optional[str] = None  # (texto) Modelo do patch panel quando houver novo fornecimento (CommScope/Furukawa/Systimax ou "Outro: <texto>")
    q1_qtd_guias_cabos: Optional[int] = None  # (número) Quantidade de guias de cabos (usar apenas quando q1_incluir_guia = True)
    q1_patch_cords_modelo: Optional[str] = None  # (texto) Modelo/descrição dos patch cords (comprimentos, categoria, etc.)
    q1_patch_cords_cor: Optional[str] = None  # (texto) Cor ou cores dos patch cords utilizados
    q1_patch_panel_existente_nome: Optional[str] = None  # (texto) Identificação do patch panel existente (quando não for novo)
    q1_modelo_patch_panel: Optional[str] = None

    # ---------------- Quantitativo 02 - Switch ----------------
    q2_novo_switch: Optional[bool] = None  # (sim/não) Se haverá fornecimento de switch novo
    q2_fornecedor_switch: Optional[str] = None  # (texto) Quem fornece o switch: 'fornecedor_interno' ou 'cliente'
    q2_modelo_switch: Optional[str] = None  # (texto) Modelo do switch (novo ou existente)
    q2_switch_foto_url: Optional[str] = None  # (texto) URL/caminho da foto do switch
    q2_switch_existente_nome: Optional[str] = None  # (texto) Nome/identificação do switch existente (quando não for novo)
    q2_observacoes: Optional[str] = None  # (texto) Observações específicas sobre switches/rede de acesso

    # ---------------- Quantitativo 03 – Cabeamento Óptico ----------------
    q3_tipo_fibra: Optional[str] = None  # (texto) Tipo de fibra (ex.: monomodo, multimodo)
    q3_qtd_fibras_por_cabo: Optional[int] = None  # (número) Quantidade de fibras por cabo óptico
    q3_tipo_conector: Optional[str] = None  # (texto) Tipo de conector (ex.: SC, LC)
    q3_novo_dio: Optional[bool] = None  # (sim/não) Se será fornecido DIO novo
    q3_caixa_terminacao: Optional[bool] = None  # (sim/não) Se haverá caixa de terminação óptica
    q3_caixa_emenda: Optional[bool] = None  # (sim/não) Se haverá caixa de emenda
    q3_qtd_cabos: Optional[int] = None  # (número) Quantidade de cabos ópticos
    q3_tamanho_total_m: Optional[float] = None  # (número) Tamanho total estimado dos cabos ópticos em metros
    q3_qtd_cordoes_opticos: Optional[int] = None  # (número) Quantidade de cordões ópticos
    q3_marca_cab_optico: Optional[str] = None  # (texto) Marca do cabeamento óptico
    q3_modelo_dio: Optional[str] = None  # (texto) Modelo do DIO utilizado/fornecido
    q3_modelo_cordao_optico: Optional[str] = None  # (texto) Modelo/descrição dos cordões ópticos (comprimento, tipo de conector, etc.)
    q3_observacoes: Optional[str] = None  # (texto) Observações específicas da parte óptica

    # ---------------- Quantitativo 04 – Equipamentos (Câmeras, NVR/DVR, conversor, GBIC) ----------------
    q4_camera: Optional[bool] = None  # (sim/não) Se o escopo inclui câmeras de CFTV
    q4_nvr_dvr: Optional[bool] = None  # (sim/não) Se inclui NVR/DVR
    q4_camera_nova: Optional[bool] = None  # (sim/não) Indica se as câmeras são novas (caso contrário, realocação)
    q4_camera_modelo: Optional[str] = None  # (texto) Modelo das câmeras
    q4_camera_qtd: Optional[int] = None  # (número) Quantidade de câmeras do modelo indicado
    q4_camera_fornecedor: Optional[str] = None  # (texto) Quem fornece as câmeras: 'fornecedor_interno' ou 'cliente'
    q4_nvr_dvr_modelo: Optional[str] = None  # (texto) Modelo do NVR ou DVR

    # ---------------- Quantitativo 05 – Infraestrutura ----------------
    q5_nova_eletrocalha: Optional[bool] = None  # (sim/não) Se será necessária nova eletrocalha
    q5_novo_eletroduto: Optional[bool] = None  # (sim/não) Se será necessário novo eletroduto
    q5_novo_rack: Optional[bool] = None  # (sim/não) Se haverá fornecimento de rack novo
    q5_instalacao_eletrica: Optional[bool] = None  # (sim/não) Se envolve instalação elétrica complementar
    q5_nobreak: Optional[bool] = None  # (sim/não) Se envolve fornecimento/instalação de nobreak
    q5_serralheria: Optional[bool] = None  # (sim/não) Se serão necessários serviços de serralheria/suportes especiais
    q5_eletrocalha_modelo: Optional[str] = None  # (texto) Modelo/descrição da eletrocalha
    q5_eletrocalha_qtd: Optional[int] = None  # (número) Quantidade de eletrocalhas
    q5_eletroduto_modelo: Optional[str] = None  # (texto) Modelo/descrição do eletroduto
    q5_eletroduto_qtd: Optional[int] = None  # (número) Quantidade de eletrodutos
    q5_rack_modelo: Optional[str] = None  # (texto) Modelo/descrição do rack
    q5_rack_qtd: Optional[int] = None  # (número) Quantidade de racks
    q5_nobreak_modelo: Optional[str] = None  # (texto) Modelo/descrição do nobreak
    q5_nobreak_qtd: Optional[int] = None  # (número) Quantidade de nobreaks
    q5_serralheria_descricao: Optional[str] = None  # (texto) Descrição detalhada da serralheria necessária
    q5_instalacao_eletrica_obs: Optional[str] = None  # (texto) Observações adicionais sobre instalação elétrica

    # ---------------- Quantitativo 09 – Análise de Painel de Automação (Controle de Acesso) ----------------
    q9_tensao_fonte: Optional[str] = None  # (texto) Tensão da fonte (12V, 24V, ou outro)
    q9_tensao_fonte_outro: Optional[str] = None  # (texto) Valor customizado se "outro"
    q9_novo_cabeamento: Optional[bool] = None  # (sim/não) Se será fornecido novo cabeamento
    q9_tipo_cabeamento: Optional[str] = None  # (texto) Tipo do cabeamento (7 vias, 14 vias, outro)
    q9_tipo_cabeamento_outro: Optional[str] = None  # (texto) Valor customizado se "outro"
    q9_quantidade_metros: Optional[float] = None  # (número decimal) Quantidade de metros do cabeamento

    # Quantitativo 10 - Portas (Controle de Acesso)
    q10_tipo_porta: Optional[str] = None  # (texto) Tipo de porta (pivotante ou deslizante)
    q10_servo_motor: Optional[bool] = None  # (sim/não) Servo motor (apenas para pivotante)
    q10_servo_motor_qtd: Optional[int] = None  # (número) Quantidade de servo motores
    q10_ponto_eletrico_novo: Optional[bool] = None  # (sim/não) Precisa de ponto elétrico novo
    q10_suporte_eletroimã: Optional[bool] = None  # (sim/não) Suporte para eletroímã/fechadura eletrônica
    q10_suporte_eletroimã_qtd: Optional[int] = None  # (número) Quantidade de suportes
    q10_botoeira_saida: Optional[bool] = None  # (sim/não) Botoeira de saída
    q10_botoeira_saida_qtd: Optional[int] = None  # (número) Quantidade de botoeiras de saída
    q10_botoeira_emergencia: Optional[bool] = None  # (sim/não) Botoeira de emergência
    q10_botoeira_emergencia_qtd: Optional[int] = None  # (número) Quantidade de botoeiras de emergência
    q10_leitor_cartao: Optional[bool] = None  # (sim/não) Leitor de cartão
    q10_leitor_cartao_qtd: Optional[int] = None  # (número) Quantidade de leitores de cartão
    q10_leitor_facial: Optional[bool] = None  # (sim/não) Leitor facial
    q10_leitor_facial_qtd: Optional[int] = None  # (número) Quantidade de leitores faciais
    q10_sensor_presenca: Optional[bool] = None  # (sim/não) Sensor de presença
    q10_sensor_presenca_qtd: Optional[int] = None  # (número) Quantidade de sensores de presença
    q10_sensor_barreira: Optional[bool] = None  # (sim/não) Sensor de barreira/segurança
    q10_sensor_barreira_qtd: Optional[int] = None  # (número) Quantidade de sensores de barreira
    q9_observacoes: Optional[str] = None  # (texto) Observações adicionais sobre painel de automação
    q10_observacoes: Optional[str] = None  # (texto) Observações adicionais sobre portas
    q6_modelo: Optional[str] = None  # (texto) Modelo do equipamento de catraca/torniquete/cancela
    q6_quantidade: Optional[int] = None  # (número) Quantidade de catracas/torniquetes/cancelas
    q6_leitor_facial: Optional[bool] = None  # (sim/não) Leitor facial
    q6_leitor_facial_qtd: Optional[int] = None  # (número) Quantidade de leitores faciais
    q6_suporte_leitor_facial: Optional[bool] = None  # (sim/não) Suporte para leitor facial
    q6_suporte_leitor_facial_qtd: Optional[int] = None  # (número) Quantidade de suportes para leitor facial
    q6_leitor_cartao: Optional[bool] = None  # (sim/não) Leitor de cartão
    q6_leitor_cartao_qtd: Optional[int] = None  # (número) Quantidade de leitores de cartão
    q6_suporte_leitor_cartao: Optional[bool] = None  # (sim/não) Suporte para leitor de cartão
    q6_suporte_leitor_cartao_qtd: Optional[int] = None  # (número) Quantidade de suportes para leitor de cartão
    q6_licenca_software: Optional[bool] = None  # (sim/não) Licença do software
    q6_no_break: Optional[bool] = None  # (sim/não) No break
    q6_servidor: Optional[bool] = None  # (sim/não) Servidor
    q6_observacoes: Optional[str] = None  # (texto) Observações adicionais sobre catracas/torniquetes/cancelas

    # Quantitativo 10 - Novos campos (Expansão)
    q10_eletroimã_fechadura: Optional[bool] = None  # (sim/não) Precisa de eletroímã/fechadura
    q10_eletroimã_fechadura_modelo: Optional[str] = None  # (texto) Modelo do eletroímã/fechadura
    q10_eletroimã_fechadura_qtd: Optional[int] = None  # (número) Quantidade de eletroímãs/fechaduras
    q10_mola_hidraulica: Optional[bool] = None  # (sim/não) Precisa de mola hidráulica
    q10_mola_hidraulica_tipo: Optional[str] = None  # (texto) Tipo de mola: piso ou aérea
    q10_mola_hidraulica_qtd: Optional[int] = None  # (número) Quantidade de molas hidráulicas
    q10_protecao_botoeira_emergencia_qtd: Optional[int] = None  # (número) Quantidade de proteções para botoeira emergência
    q10_botoeira_saida_modelo: Optional[str] = None  # (texto) Modelo da botoeira de saída
    q10_botoeira_emergencia_modelo: Optional[str] = None  # (texto) Modelo da botoeira de emergência
    q10_leitor_cartao_modelo: Optional[str] = None  # (texto) Modelo do leitor de cartão
    q10_leitor_facial_modelo: Optional[str] = None  # (texto) Modelo do leitor facial
    q10_sensor_presenca_modelo: Optional[str] = None  # (texto) Modelo do sensor de presença
    q10_sensor_barreira_modelo: Optional[str] = None  # (texto) Modelo do sensor de barreira/segurança

    # Quantitativo 06 - Expansão de campos
    q6_no_break_modelo: Optional[str] = None  # (texto) Modelo do no-break
    q6_no_break_qtd: Optional[int] = None  # (número) Quantidade de no-breaks
    q6_servidor_modelo: Optional[str] = None  # (texto) Modelo do servidor
    q6_servidor_qtd: Optional[int] = None  # (número) Quantidade de servidores

    localizacao_imagem1_url: Optional[str] = None  # (texto) URL/caminho da primeira imagem de localização (planta/foto)
    localizacao_imagem2_url: Optional[str] = None  # (texto) URL/caminho da segunda imagem de localização (planta/foto)

    pre_trabalho_altura: Optional[bool] = None  # (sim/não) Indica se haverá trabalho em altura
    pre_plataforma: Optional[bool] = None  # (sim/não) Se será necessária plataforma elevatória
    pre_plataforma_modelo: Optional[str] = None  # (texto) Modelo/tipo da plataforma (tesoura, articulada, etc.)
    pre_plataforma_dias: Optional[int] = None  # (número) Quantidade de dias estimados de uso da plataforma
    pre_fora_horario_comercial: Optional[bool] = None  # (sim/não) Se o serviço será fora do horário comercial
    pre_veiculo_empresa: Optional[bool] = None  # (sim/não) Se será necessário veículo da empresa
    pre_container_materiais: Optional[bool] = None  # (sim/não) Se será necessário contêiner/armazenamento de materiais

    encarregado_dias: Optional[int] = None  # (número - Tabela 4) Quantidade de dias de encarregado
    instalador_dias: Optional[int] = None  # (número - Tabela 4) Quantidade de dias de instalador
    auxiliar_dias: Optional[int] = None  # (número - Tabela 4) Quantidade de dias de auxiliar
    tecnico_de_instalacao_dias: Optional[int] = None  # (número - Tabela 4) Quantidade de dias de técnico de instalação
    tecnico_em_seguranca_dias: Optional[int] = None  # (número - Tabela 4) Quantidade de dias de técnico em segurança

    encarregado_hora_extra: Optional[int] = None  # (número - Tabela 4) Horas extras de encarregado
    instalador_hora_extra: Optional[int] = None  # (número - Tabela 4) Horas extras de instalador
    auxiliar_hora_extra: Optional[int] = None  # (número - Tabela 4) Horas extras de auxiliar
    tecnico_de_instalacao_hora_extra: Optional[int] = None  # (número - Tabela 4) Horas extras de técnico de instalação
    tecnico_em_seguranca_hora_extra: Optional[int] = None  # (número - Tabela 4) Horas extras de técnico em segurança

    encarregado_trabalho_domingo: Optional[int] = None  # (número - Tabela 4) Quantidade de domingos trabalhados pelo encarregado
    instalador_trabalho_domingo: Optional[int] = None  # (número - Tabela 4) Quantidade de domingos trabalhados pelo instalador
    auxiliar_trabalho_domingo: Optional[int] = None  # (número - Tabela 4) Quantidade de domingos trabalhados pelo auxiliar
    tecnico_de_instalacao_trabalho_domingo: Optional[int] = None  # (número - Tabela 4) Domingos trabalhados pelo técnico de instalação
    tecnico_em_seguranca_trabalho_domingo: Optional[int] = None  # (número - Tabela 4) Domingos trabalhados pelo técnico em segurança

    almoco_qtd: Optional[int] = None  # (número - Tabela 5) Quantidade estimada de almoços
    lanche_qtd: Optional[int] = None  # (número - Tabela 5) Quantidade estimada de lanches

    cronograma_execucao: Optional[bool] = None  # (sim/não) Se está previsto cronograma formal de execução
    dias_instalacao: Optional[int] = None  # (número) Quantidade estimada de dias de instalação
    as_built: Optional[bool] = None  # (sim/não) Se será entregue documentação As Built
    dias_entrega_relatorio: Optional[int] = None  # (número) Prazo em dias para entrega de relatório/AS BUILT
    art: Optional[bool] = None  # (sim/não) Se será emitida ART (Anotação de Responsabilidade Técnica)

    # ====== Materiais do Painel de Automação (Q9) ======
    materiais_painel: Optional[List[MaterialPainelBaseSchema]] = None  # Lista de materiais do painel

class AvaliacaoUpdateSchema(BaseModel):  # schema usado para atualizar uma avaliação existente (todos os campos opcionais)
    #tipo_formulario
    tipo_formulario: Optional[str] = Field(                 # novo campo para atualizar o tipo de formulário
        None,                                               # se None, não altera o valor atual no banco
        description="Tipo do formulário (ex.: redes, infraestrutura, etc.)"  # descrição no Swagger
    )
    #tipo_formulario
    cliente_nome: Optional[str] = Field(  # nome do cliente, opcional na atualização
        None,  # se None, não altera o valor atual no banco
        description="Nome do cliente"  # descrição do campo na documentação (Swagger)
    )
    data_avaliacao: Optional[str] = Field(  # data da avaliação em string, opcional (iremos converter manualmente)
        None,  # se None, mantém a data atual
        description="Data da avaliação no formato YYYY-MM-DD"  # formato esperado ao atualizar
    )
    local: Optional[str] = Field(  # local da instalação, opcional
        None,  # se não enviado, não altera
        description="Local da instalação"  # descrição do campo
    )
    objeto: Optional[str] = Field(  # objeto da avaliação, opcional
        None,  # valor padrão None
        description="Objeto da avaliação"  # descrição do campo
    )
    status: Optional[str] = Field(  # status da avaliação, opcional
        None,  # se None, mantém o status atual
        description="Status da avaliação (aberto, aprovado, etc.)"  # explicação do campo
    )
    pedido_compra: Optional[str] = Field(  # pedido de compra do cliente
        None,  # se None, mantém o valor atual
        description="Número do pedido de compra (somente admin/comercial)"
    )
    numero_proposta: Optional[str] = Field(  # número da proposta comercial
        None,  # se None, mantém o valor atual
        description="Número da proposta comercial (somente admin/comercial)"
    )
    equipe: Optional[str] = Field(  # equipe responsável, opcional
        None,  # não enviado = não altera
        description="Equipe responsável pela avaliação"  # descrição do campo
    )
    responsavel_avaliacao: Optional[str] = Field(  # responsável técnico pela avaliação, opcional
        None,  # não enviado = não altera
        description="Responsável técnico pela avaliação"  # descrição do campo
    )
    contato: Optional[str] = Field(  # nome do contato do cliente, opcional
        None,  # valor padrão None
        description="Nome do contato do cliente"  # descrição do campo
    )
    email_cliente: Optional[str] = Field(  # e-mail do cliente, opcional
        None,  # se None, mantém o valor atual
        description="E-mail do cliente"  # descrição do campo
    )
    escopo_texto: Optional[str] = Field(  # escopo da avaliação, opcional
        None,  # se None, não altera
        description="Descrição do escopo da avaliação"  # descrição do campo
    )

    servico_fora_montes_claros: Optional[bool] = Field(  # indica se o serviço será fora de Montes Claros
        None,  # None significa "não alterar"
        description="Serviço fora de Montes Claros (True/False)"  # descrição do campo
    )
    servico_intermediario: Optional[bool] = Field(  # indica se haverá empresa intermediária/empreiteira
        None,  # None = não alterar
        description="Serviço intermediário / empreiteira (True/False)"  # descrição do campo
    )

    # ---------------- Quantitativo 01 - Patch Panel / Cabeamento UTP ----------------
    q1_categoria_cab: Optional[str] = Field(  # categoria de cabeamento estruturado
        None,  # None = não alterar
        description="Categoria do cabeamento (ex.: Cat5e, Cat6, Cat6a)"  # descrição do campo
    )
    q1_blindado: Optional[bool] = Field(  # indica se o cabeamento UTP será blindado
        None,  # None = não alterar
        description="Cabeamento blindado (True/False)"  # descrição do campo
    )
    q1_novo_patch_panel: Optional[bool] = Field(  # indica se será fornecido patch panel novo
        None,  # None = não alterar
        description="Fornecer patch panel novo (True/False)"  # descrição do campo
    )
    q1_incluir_guia: Optional[bool] = Field(  # se deve incluir guia de passagem / duto auxiliar
        None,  # None = não alterar
        description="Incluir guia de passagem (True/False)"  # descrição do campo
    )
    q1_qtd_pontos_rede: Optional[int] = Field(  # quantidade de pontos de rede
        None,  # None = não alterar
        description="Quantidade de pontos de rede"  # descrição do campo
    )
    q1_qtd_cabos: Optional[int] = Field(  # quantidade de cabos de rede necessários
        None,  # None = não alterar
        description="Quantidade de cabos de rede"  # descrição do campo
    )
    q1_qtd_portas_patch_panel: Optional[int] = Field(  # quantidade de portas no patch panel
        None,  # None = não alterar
        description="Quantidade de portas no patch panel"  # descrição do campo
    )
    q1_qtd_patch_cords: Optional[int] = Field(  # quantidade de patch cords
        None,  # None = não alterar
        description="Quantidade de patch cords"  # descrição do campo
    )
    q1_marca_cab: Optional[str] = Field(  # marca do cabeamento UTP
        None,  # None = não alterar
        description="Marca do cabeamento UTP (CommScope, Furukawa ou 'Outro: <texto>')"  # descrição do campo
    )
    q1_modelo_patch_panel: Optional[str] = Field(  # modelo do patch panel
        None,  # None = não alterar
        description="Modelo do patch panel quando houver novo fornecimento (CommScope 24 portas, Furukawa 24 portas, Systimax 24 portas ou 'Outro: <texto>')"  # descrição do campo
    )
    q1_qtd_guias_cabos: Optional[int] = Field(                    # quantidade de guias de cabos
        None,                                                     # None = não alterar
        description="Quantidade de guias de cabos (preenchida apenas quando q1_incluir_guia = True)"  # descrição do campo
    )
    q1_patch_cords_modelo: Optional[str] = Field(  # modelo dos patch cords
        None,  # None = não alterar
        description="Modelo/descrição dos patch cords (comprimentos, categoria, etc.)"  # descrição do campo
    )
    q1_patch_cords_cor: Optional[str] = Field(  # cor dos patch cords
        None,  # None = não alterar
        description="Cor ou cores dos patch cords"  # descrição do campo
    )
    q1_patch_panel_existente_nome: Optional[str] = Field(  # identificação do patch panel existente
        None,  # None = não alterar
        description="Identificação do patch panel existente (quando não houver novo fornecimento)"  # descrição do campo
    )

    # ---------------- Quantitativo 02 - Switch ----------------
    q2_novo_switch: Optional[bool] = Field(  # indica se haverá fornecimento de switch novo
        None,  # None = não alterar
        description="Fornecer switch novo (True/False)"  # descrição do campo
    )
    q2_fornecedor_switch: Optional[str] = Field(  # quem fornece o switch
        None,  # None = não alterar
        description="Quem fornece o switch: 'fornecedor_interno' ou 'cliente'"  # descrição do campo
    )
    q2_modelo_switch: Optional[str] = Field(  # modelo do switch
        None,  # None = não alterar
        description="Modelo do switch (novo ou existente)"  # descrição do campo
    )
    q2_switch_foto_url: Optional[str] = Field(  # URL da foto do switch
        None,  # None = não alterar
        description="URL/caminho da foto do switch"  # descrição do campo
    )
    q2_switch_existente_nome: Optional[str] = Field(  # identificação do switch existente
        None,  # None = não alterar
        description="Nome/identificação do switch existente (quando não for novo)"  # descrição do campo
    )
    q2_observacoes: Optional[str] = Field(  # observações específicas sobre switches
        None,  # None = não alterar
        description="Observações sobre switches / rede de acesso"  # descrição do campo
    )

    # ---------------- Quantitativo 03 – Cabeamento Óptico ----------------
    q3_tipo_fibra: Optional[str] = Field(  # tipo de fibra (SM, OM1, OM2, etc.)
        None,  # None = não alterar
        description="Tipo de fibra óptica (SM, OM, etc.)"  # descrição do campo
    )
    q3_qtd_fibras_por_cabo: Optional[int] = Field(  # quantidade de fibras por cabo
        None,  # None = não alterar
        description="Quantidade de fibras por cabo óptico"  # descrição do campo
    )
    q3_tipo_conector: Optional[str] = Field(  # tipo de conector (LC, SC, etc.)
        None,  # None = não alterar
        description="Tipo de conector óptico (LC, SC, etc.)"  # descrição do campo
    )
    q3_novo_dio: Optional[bool] = Field(  # indica se será fornecido DIO novo
        None,  # None = não alterar
        description="Fornecer DIO novo (True/False)"  # descrição do campo
    )
    q3_caixa_terminacao: Optional[bool] = Field(  # indica se haverá caixa de terminação óptica
        None,  # None = não alterar
        description="Caixa de terminação óptica (True/False)"  # descrição do campo
    )
    q3_caixa_emenda: Optional[bool] = Field(  # indica se haverá caixa de emenda óptica
        None,  # None = não alterar
        description="Caixa de emenda óptica (True/False)"  # descrição do campo
    )
    q3_qtd_cabos: Optional[int] = Field(  # quantidade de cabos ópticos
        None,  # None = não alterar
        description="Quantidade de cabos ópticos"  # descrição do campo
    )
    q3_tamanho_total_m: Optional[float] = Field(  # tamanho total dos cabos em metros
        None,  # None = não alterar
        description="Tamanho total dos cabos ópticos em metros"  # descrição do campo
    )
    q3_qtd_cordoes_opticos: Optional[int] = Field(  # quantidade de cordões ópticos
        None,  # None = não alterar
        description="Quantidade de cordões ópticos"  # descrição do campo
    )
    q3_marca_cab_optico: Optional[str] = Field(  # marca do cabo óptico
        None,  # None = não alterar
        description="Marca do cabeamento óptico"  # descrição do campo
    )
    q3_modelo_dio: Optional[str] = Field(  # modelo do DIO
        None,  # None = não alterar
        description="Modelo do DIO utilizado/fornecido"  # descrição do campo
    )
    q3_modelo_cordao_optico: Optional[str] = Field(  # modelo dos cordões
        None,  # None = não alterar
        description="Modelo/descrição dos cordões ópticos (comprimento, tipo de conector, etc.)"  # descrição do campo
    )
    q3_observacoes: Optional[str] = Field(  # observações da parte óptica
        None,  # None = não alterar
        description="Observações sobre cabeamento óptico"  # descrição do campo
    )

    # ---------------- Quantitativo 04 – Equipamentos (Câmeras, NVR/DVR, conversor, GBIC) ----------------
    q4_camera: Optional[bool] = Field(  # indica se o escopo inclui câmeras de CFTV
        None,  # None = não alterar
        description="Inclui câmeras de CFTV (True/False)"  # descrição do campo
    )
    q4_nvr_dvr: Optional[bool] = Field(  # indica se inclui NVR/DVR
        None,  # None = não alterar
        description="Inclui NVR/DVR (True/False)"  # descrição do campo
    )
    q4_camera_nova: Optional[bool] = Field(  # indica se as câmeras são novas
        None,  # None = não alterar
        description="Câmeras novas (True) ou realocação (False)"  # descrição do campo
    )
    q4_camera_modelo: Optional[str] = Field(  # modelo das câmeras
        None,  # None = não alterar
        description="Modelo das câmeras de CFTV"  # descrição do campo
    )
    q4_camera_qtd: Optional[int] = Field(  # quantidade de câmeras
        None,  # None = não alterar
        description="Quantidade de câmeras do modelo indicado"  # descrição do campo
    )
    q4_camera_fornecedor: Optional[str] = Field(  # quem fornece as câmeras
        None,  # None = não alterar
        description="Quem fornece as câmeras: 'fornecedor_interno' ou 'cliente'"  # descrição do campo
    )
    q4_nvr_dvr_modelo: Optional[str] = Field(  # modelo do NVR/DVR
        None,  # None = não alterar
        description="Modelo do NVR ou DVR"  # descrição do campo
    )

    # ---------------- Quantitativo 05 – Infraestrutura ----------------
    q5_nova_eletrocalha: Optional[bool] = Field(  # indica se será necessária nova eletrocalha
        None,  # None = não alterar
        description="Nova eletrocalha (True/False)"  # descrição do campo
    )
    q5_novo_eletroduto: Optional[bool] = Field(  # indica se será necessário novo eletroduto
        None,  # None = não alterar
        description="Novo eletroduto (True/False)"  # descrição do campo
    )
    q5_novo_rack: Optional[bool] = Field(  # indica se haverá fornecimento de rack novo
        None,  # None = não alterar
        description="Novo rack (True/False)"  # descrição do campo
    )
    q5_instalacao_eletrica: Optional[bool] = Field(  # indica se envolve instalação elétrica complementar
        None,  # None = não alterar
        description="Instalação elétrica complementar (True/False)"  # descrição do campo
    )
    q5_nobreak: Optional[bool] = Field(  # indica se envolve fornecimento/instalação de nobreak
        None,  # None = não alterar
        description="Inclui nobreak (True/False)"  # descrição do campo
    )
    q5_serralheria: Optional[bool] = Field(  # indica se serão necessários serviços de serralheria
        None,  # None = não alterar
        description="Serviços de serralheria / suportes (True/False)"  # descrição do campo
    )
    q5_eletrocalha_modelo: Optional[str] = Field(  # modelo da eletrocalha
        None,  # None = não alterar
        description="Modelo/descrição da eletrocalha"  # descrição do campo
    )
    q5_eletrocalha_qtd: Optional[int] = Field(  # quantidade de eletrocalhas
        None,  # None = não alterar
        description="Quantidade de eletrocalhas"  # descrição do campo
    )
    q5_eletroduto_modelo: Optional[str] = Field(  # modelo do eletroduto
        None,  # None = não alterar
        description="Modelo/descrição do eletroduto"  # descrição do campo
    )
    q5_eletroduto_qtd: Optional[int] = Field(  # quantidade de eletrodutos
        None,  # None = não alterar
        description="Quantidade de eletrodutos"  # descrição do campo
    )
    q5_rack_modelo: Optional[str] = Field(  # modelo do rack
        None,  # None = não alterar
        description="Modelo/descrição do rack"  # descrição do campo
    )
    q5_rack_qtd: Optional[int] = Field(  # quantidade de racks
        None,  # None = não alterar
        description="Quantidade de racks"  # descrição do campo
    )
    q5_nobreak_modelo: Optional[str] = Field(  # modelo do nobreak
        None,  # None = não alterar
        description="Modelo/descrição do nobreak"  # descrição do campo
    )
    q5_nobreak_qtd: Optional[int] = Field(  # quantidade de nobreaks
        None,  # None = não alterar
        description="Quantidade de nobreaks"  # descrição do campo
    )
    q5_serralheria_descricao: Optional[str] = Field(  # descrição da serralheria
        None,  # None = não alterar
        description="Descrição detalhada da serralheria necessária"  # descrição do campo
    )
    q5_instalacao_eletrica_obs: Optional[str] = Field(  # observações da instalação elétrica
        None,  # None = não alterar
        description="Observações adicionais sobre instalação elétrica"  # descrição do campo
    )

    # ---------------- Quantitativo 09 – Análise de Painel de Automação (Controle de Acesso) ----------------
    q9_tensao_fonte: Optional[str] = Field(None, description="Tensão da fonte (12V, 24V, ou outro)")
    q9_tensao_fonte_outro: Optional[str] = Field(None, description="Valor customizado se outro")
    q9_novo_cabeamento: Optional[bool] = Field(None, description="Se será fornecido novo cabeamento")
    q9_tipo_cabeamento: Optional[str] = Field(None, description="Tipo do cabeamento (7 vias, 14 vias, outro)")
    q9_tipo_cabeamento_outro: Optional[str] = Field(None, description="Valor customizado se outro")
    q9_quantidade_metros: Optional[float] = Field(None, description="Quantidade de metros do cabeamento")

    # ---------------- Quantitativo 10 – Portas (Controle de Acesso) ----------------
    q10_tipo_porta: Optional[str] = Field(None, description="Tipo de porta (pivotante ou deslizante)")
    q10_servo_motor: Optional[bool] = Field(None, description="Servo motor (apenas para pivotante)")
    q10_servo_motor_qtd: Optional[int] = Field(None, description="Quantidade de servo motores")
    q10_ponto_eletrico_novo: Optional[bool] = Field(None, description="Precisa de ponto elétrico novo")
    q10_suporte_eletroimã: Optional[bool] = Field(None, description="Suporte para eletroímã/fechadura eletrônica")
    q10_suporte_eletroimã_qtd: Optional[int] = Field(None, description="Quantidade de suportes")
    q10_botoeira_saida: Optional[bool] = Field(None, description="Botoeira de saída")
    q10_botoeira_saida_qtd: Optional[int] = Field(None, description="Quantidade de botoeiras de saída")
    q10_botoeira_emergencia: Optional[bool] = Field(None, description="Botoeira de emergência")
    q10_botoeira_emergencia_qtd: Optional[int] = Field(None, description="Quantidade de botoeiras de emergência")
    q10_leitor_cartao: Optional[bool] = Field(None, description="Leitor de cartão")
    q10_leitor_cartao_qtd: Optional[int] = Field(None, description="Quantidade de leitores de cartão")
    q10_leitor_facial: Optional[bool] = Field(None, description="Leitor facial")
    q10_leitor_facial_qtd: Optional[int] = Field(None, description="Quantidade de leitores faciais")
    q10_sensor_presenca: Optional[bool] = Field(None, description="Sensor de presença")
    q10_sensor_presenca_qtd: Optional[int] = Field(None, description="Quantidade de sensores de presença")
    q10_sensor_barreira: Optional[bool] = Field(None, description="Sensor de barreira/segurança")
    q10_sensor_barreira_qtd: Optional[int] = Field(None, description="Quantidade de sensores de barreira")
    q9_observacoes: Optional[str] = Field(None, description="Observações adicionais sobre painel de automação")
    q10_observacoes: Optional[str] = Field(None, description="Observações adicionais sobre portas")
    q6_modelo: Optional[str] = Field(None, description="Modelo do equipamento de catraca/torniquete/cancela")
    q6_quantidade: Optional[int] = Field(None, description="Quantidade de catracas/torniquetes/cancelas")
    q6_leitor_facial: Optional[bool] = Field(None, description="Leitor facial")
    q6_leitor_facial_qtd: Optional[int] = Field(None, description="Quantidade de leitores faciais")
    q6_suporte_leitor_facial: Optional[bool] = Field(None, description="Suporte para leitor facial")
    q6_suporte_leitor_facial_qtd: Optional[int] = Field(None, description="Quantidade de suportes para leitor facial")
    q6_leitor_cartao: Optional[bool] = Field(None, description="Leitor de cartão")
    q6_leitor_cartao_qtd: Optional[int] = Field(None, description="Quantidade de leitores de cartão")
    q6_suporte_leitor_cartao: Optional[bool] = Field(None, description="Suporte para leitor de cartão")
    q6_suporte_leitor_cartao_qtd: Optional[int] = Field(None, description="Quantidade de suportes para leitor de cartão")
    q6_licenca_software: Optional[bool] = Field(None, description="Licença do software")
    q6_no_break: Optional[bool] = Field(None, description="No break")
    q6_servidor: Optional[bool] = Field(None, description="Servidor")
    q6_observacoes: Optional[str] = Field(None, description="Observações adicionais sobre catracas/torniquetes/cancelas")

    # Quantitativo 10 - Novos campos (Expansão)
    q10_eletroimã_fechadura: Optional[bool] = Field(None, description="Precisa de eletroímã/fechadura")
    q10_eletroimã_fechadura_modelo: Optional[str] = Field(None, description="Modelo do eletroímã/fechadura")
    q10_eletroimã_fechadura_qtd: Optional[int] = Field(None, description="Quantidade de eletroímãs/fechaduras")
    q10_mola_hidraulica: Optional[bool] = Field(None, description="Precisa de mola hidráulica")
    q10_mola_hidraulica_tipo: Optional[str] = Field(None, description="Tipo de mola: piso ou aérea")
    q10_mola_hidraulica_qtd: Optional[int] = Field(None, description="Quantidade de molas hidráulicas")
    q10_protecao_botoeira_emergencia_qtd: Optional[int] = Field(None, description="Quantidade de proteções para botoeira emergência")
    q10_botoeira_saida_modelo: Optional[str] = Field(None, description="Modelo da botoeira de saída")
    q10_botoeira_emergencia_modelo: Optional[str] = Field(None, description="Modelo da botoeira de emergência")
    q10_leitor_cartao_modelo: Optional[str] = Field(None, description="Modelo do leitor de cartão")
    q10_leitor_facial_modelo: Optional[str] = Field(None, description="Modelo do leitor facial")
    q10_sensor_presenca_modelo: Optional[str] = Field(None, description="Modelo do sensor de presença")
    q10_sensor_barreira_modelo: Optional[str] = Field(None, description="Modelo do sensor de barreira/segurança")

    # Quantitativo 06 - Expansão de campos
    q6_no_break_modelo: Optional[str] = Field(None, description="Modelo do no-break")
    q6_no_break_qtd: Optional[int] = Field(None, description="Quantidade de no-breaks")
    q6_servidor_modelo: Optional[str] = Field(None, description="Modelo do servidor")
    q6_servidor_qtd: Optional[int] = Field(None, description="Quantidade de servidores")

    localizacao_imagem1_url: Optional[str] = Field(  # URL/caminho da primeira imagem de localização
        None,  # None = não alterar
        description="URL da primeira imagem de localização"  # descrição do campo
    )
    localizacao_imagem2_url: Optional[str] = Field(  # URL/caminho da segunda imagem de localização
        None,  # None = não alterar
        description="URL da segunda imagem de localização"  # descrição do campo
    )

    pre_trabalho_altura: Optional[bool] = Field(  # indica se haverá trabalho em altura
        None,  # None = não alterar
        description="Trabalho em altura (True/False)"  # descrição do campo
    )
    pre_plataforma: Optional[bool] = Field(  # indica se será necessária plataforma elevatória
        None,  # None = não alterar
        description="Necessidade de plataforma elevatória (True/False)"  # descrição do campo
    )
    pre_plataforma_modelo: Optional[str] = Field(  # modelo/tipo da plataforma
        None,  # None = não alterar
        description="Modelo/tipo da plataforma elevatória"  # descrição do campo
    )
    pre_plataforma_dias: Optional[int] = Field(  # quantidade de dias de uso da plataforma
        None,  # None = não alterar
        description="Quantidade de dias de uso da plataforma"  # descrição do campo
    )
    pre_fora_horario_comercial: Optional[bool] = Field(  # indica se o serviço será fora do horário comercial
        None,  # None = não alterar
        description="Serviço fora do horário comercial (True/False)"  # descrição do campo
    )
    pre_veiculo_empresa: Optional[bool] = Field(  # indica se será necessário veículo da empresa
        None,  # None = não alterar
        description="Uso de veículo da empresa (True/False)"  # descrição do campo
    )
    pre_container_materiais: Optional[bool] = Field(  # indica se será necessário contêiner de materiais
        None,  # None = não alterar
        description="Necessidade de contêiner de materiais (True/False)"  # descrição do campo
    )

    encarregado_dias: Optional[int] = Field(  # quantidade de dias de encarregado
        None,  # None = não alterar
        description="Quantidade de dias de encarregado"  # descrição do campo
    )
    instalador_dias: Optional[int] = Field(  # quantidade de dias de instalador
        None,  # None = não alterar
        description="Quantidade de dias de instalador"  # descrição do campo
    )
    auxiliar_dias: Optional[int] = Field(  # quantidade de dias de auxiliar
        None,  # None = não alterar
        description="Quantidade de dias de auxiliar"  # descrição do campo
    )
    tecnico_de_instalacao_dias: Optional[int] = Field(  # quantidade de dias de técnico de instalação
        None,  # None = não alterar
        description="Quantidade de dias de técnico de instalação"  # descrição do campo
    )
    tecnico_em_seguranca_dias: Optional[int] = Field(  # quantidade de dias de técnico em segurança
        None,  # None = não alterar
        description="Quantidade de dias de técnico em segurança"  # descrição do campo
    )

    encarregado_hora_extra: Optional[int] = Field(  # horas extras de encarregado
        None,  # None = não alterar
        description="Horas extras de encarregado"  # descrição do campo
    )
    instalador_hora_extra: Optional[int] = Field(  # horas extras de instalador
        None,  # None = não alterar
        description="Horas extras de instalador"  # descrição do campo
    )
    auxiliar_hora_extra: Optional[int] = Field(  # horas extras de auxiliar
        None,  # None = não alterar
        description="Horas extras de auxiliar"  # descrição do campo
    )
    tecnico_de_instalacao_hora_extra: Optional[int] = Field(  # horas extras de técnico de instalação
        None,  # None = não alterar
        description="Horas extras de técnico de instalação"  # descrição do campo
    )
    tecnico_em_seguranca_hora_extra: Optional[int] = Field(  # horas extras de técnico em segurança
        None,  # None = não alterar
        description="Horas extras de técnico em segurança"  # descrição do campo
    )

    encarregado_trabalho_domingo: Optional[int] = Field(  # domingos trabalhados pelo encarregado
        None,  # None = não alterar
        description="Domingos trabalhados pelo encarregado"  # descrição do campo
    )
    instalador_trabalho_domingo: Optional[int] = Field(  # domingos trabalhados pelo instalador
        None,  # None = não alterar
        description="Domingos trabalhados pelo instalador"  # descrição do campo
    )
    auxiliar_trabalho_domingo: Optional[int] = Field(  # domingos trabalhados pelo auxiliar
        None,  # None = não alterar
        description="Domingos trabalhados pelo auxiliar"  # descrição do campo
    )
    tecnico_de_instalacao_trabalho_domingo: Optional[int] = Field(  # domingos trabalhados pelo técnico de instalação
        None,  # None = não alterar
        description="Domingos trabalhados pelo técnico de instalação"  # descrição do campo
    )
    tecnico_em_seguranca_trabalho_domingo: Optional[int] = Field(  # domingos trabalhados pelo técnico em segurança
        None,  # None = não alterar
        description="Domingos trabalhados pelo técnico em segurança"  # descrição do campo
    )

    almoco_qtd: Optional[int] = Field(  # quantidade estimada de almoços
        None,  # None = não alterar
        description="Quantidade estimada de almoços"  # descrição do campo
    )
    lanche_qtd: Optional[int] = Field(  # quantidade estimada de lanches
        None,  # None = não alterar
        description="Quantidade estimada de lanches"  # descrição do campo
    )

    cronograma_execucao: Optional[bool] = Field(  # indica se está previsto cronograma formal de execução
        None,  # None = não alterar
        description="Cronograma formal de execução (True/False)"  # descrição do campo
    )
    dias_instalacao: Optional[int] = Field(  # quantidade estimada de dias de instalação
        None,  # None = não alterar
        description="Quantidade estimada de dias de instalação"  # descrição do campo
    )
    as_built: Optional[bool] = Field(  # indica se será entregue documentação As Built
        None,  # None = não alterar
        description="Entrega de documentação As Built (True/False)"  # descrição do campo
    )
    dias_entrega_relatorio: Optional[int] = Field(  # prazo em dias para entrega de relatório
        None,  # None = não alterar
        description="Prazo em dias para entrega de relatório / As Built"  # descrição do campo
    )
    art: Optional[bool] = Field(  # indica se será emitida ART
        None,  # None = não alterar
        description="Emissão de ART (True/False)"  # descrição do campo
    )

    # ====== Materiais do Painel de Automação (Q9) ======
    materiais_painel: Optional[List[MaterialPainelBaseSchema]] = Field(  # lista de materiais do painel
        None,  # None = não alterar
        description="Lista de materiais do painel de automação"  # descrição do campo
    )

    class Config:  # configuração do Pydantic
        orm_mode = True  # permite converter diretamente a partir de objetos ORM do SQLAlchemy

class AvaliacaoOutSchema(AvaliacaoBaseSchema):
    id: int = Field(...,                                            # id numérico da avaliação (chave primária no banco)
                    description="ID da avaliação")                  # descrição exibida na documentação/Swagger

    codigo_avaliacao: Optional[str] = Field(                        # campo opcional com o código amigável da avaliação
        None,                                                       # pode ser None em registros antigos que não tinham esse código
        description="Código amigável da avaliação (ex.: AVT2025001)"# descrição exibida na documentação/Swagger
    )

    equipe: Optional[str] = Field(                                  # equipe responsável

        None,                                                       # None significa que pode vir vazio em alguns registros
        description="Equipe responsável pela avaliação"             # descrição do campo
    )
    responsavel_avaliacao: Optional[str] = Field(                   # responsável técnico pela avaliação
        None,                                                       # opcional
        description="Responsável técnico pela avaliação"            # descrição do campo
    )
    contato: Optional[str] = Field(                                 # nome do contato do cliente
        None,                                                       # opcional
        description="Nome do contato do cliente"                    # descrição do campo
    )
    criado_por_nome: Optional[str] = Field(None, description="Nome do usuário criador da avaliação")
    email_cliente: Optional[str] = Field(                           # e-mail de contato do cliente
        None,                                                       # opcional
        description="E-mail do cliente"                             # descrição do campo
    )
    escopo_texto: Optional[str] = Field(                            # descrição textual do escopo
        None,                                                       # opcional
        description="Descrição do escopo da avaliação"              # descrição do campo
    )

    servico_fora_montes_claros: Optional[bool] = Field(             # flag indicando se o serviço é fora de Montes Claros
        None,                                                       # None = não informado
        description="Serviço fora de Montes Claros (True/False)"    # descrição do campo
    )
    servico_intermediario: Optional[bool] = Field(                  # flag indicando se há empresa intermediária/empreiteira
        None,                                                       # opcional
        description="Serviço intermediário / empreiteira (True/False)"  # descrição do campo
    )

    # ---------------- Quantitativo 01 - Patch Panel / Cabeamento UTP ----------------
    q1_categoria_cab: Optional[str] = Field(                        # categoria do cabeamento estruturado
        None,                                                       # opcional
        description="Categoria do cabeamento (ex.: Cat5e, Cat6, Cat6a)"  # descrição do campo
    )
    q1_blindado: Optional[bool] = Field(                            # indica se o cabeamento é blindado
        None,                                                       # opcional
        description="Cabeamento blindado (True/False)"              # descrição do campo
    )
    q1_novo_patch_panel: Optional[bool] = Field(                    # indica se será fornecido patch panel novo
        None,                                                       # opcional
        description="Fornecer patch panel novo (True/False)"        # descrição do campo
    )
    q1_incluir_guia: Optional[bool] = Field(                        # indica se será incluída guia de passagem
        None,                                                       # opcional
        description="Incluir guia de passagem (True/False)"         # descrição do campo
    )
    q1_qtd_guias_cabos: Optional[int] = Field(                    # quantidade de guias de cabos
        None,                                                     # opcional
        description="Quantidade de guias de cabos (usar apenas quando q1_incluir_guia = True)"  # descrição do campo
    )
    q1_qtd_pontos_rede: Optional[int] = Field(                      # quantidade de pontos de rede na área
        None,                                                       # opcional
        description="Quantidade de pontos de rede"                  # descrição do campo
    )
    q1_qtd_cabos: Optional[int] = Field(                            # quantidade de cabos de rede necessários
        None,                                                       # opcional
        description="Quantidade de cabos de rede"                   # descrição do campo
    )
    q1_qtd_portas_patch_panel: Optional[int] = Field(               # quantidade de portas do patch panel
        None,                                                       # opcional
        description="Quantidade de portas do patch panel"           # descrição do campo
    )
    q1_qtd_patch_cords: Optional[int] = Field(                      # quantidade de patch cords
        None,                                                       # opcional
        description="Quantidade de patch cords"                     # descrição do campo
    )
    q1_marca_cab: Optional[str] = Field(                            # marca do cabeamento UTP
        None,                                                       # opcional
        description="Marca do cabeamento UTP (CommScope, Furukawa ou 'Outro: <texto>')"  # descrição do campo
    )
    q1_modelo_patch_panel: Optional[str] = Field(                   # modelo do patch panel
        None,                                                       # opcional
        description="Modelo do patch panel quando houver novo fornecimento (CommScope 24 portas, Furukawa 24 portas, Systimax 24 portas ou 'Outro: <texto>')"  # descrição do campo
    )
    q1_patch_cords_modelo: Optional[str] = Field(                   # modelo/descrição dos patch cords
        None,                                                       # opcional
        description="Modelo/descrição dos patch cords (comprimentos, categoria, etc.)"  # descrição do campo
    )
    q1_patch_cords_cor: Optional[str] = Field(                      # cor ou cores dos patch cords
        None,                                                       # opcional
        description="Cor ou cores dos patch cords"                  # descrição do campo
    )
    q1_patch_panel_existente_nome: Optional[str] = Field(           # identificação do patch panel existente
        None,                                                       # opcional
        description="Identificação do patch panel existente (quando não houver novo fornecimento)"  # descrição do campo
    )

    # ---------------- Quantitativo 02 - Switch ----------------
    q2_novo_switch: Optional[bool] = Field(                         # indica se haverá fornecimento de switch novo
        None,                                                       # opcional
        description="Fornecer switch novo (True/False)"             # descrição do campo
    )
    q2_fornecedor_switch: Optional[str] = Field(                    # quem fornece o switch
        None,                                                       # opcional
        description="Quem fornece o switch: 'fornecedor_interno' ou 'cliente'"  # descrição do campo
    )
    q2_modelo_switch: Optional[str] = Field(                        # modelo do switch
        None,                                                       # opcional
        description="Modelo do switch (novo ou existente)"          # descrição do campo
    )
    q2_switch_foto_url: Optional[str] = Field(                      # URL/caminho da foto do switch
        None,                                                       # opcional
        description="URL/caminho da foto do switch"                 # descrição do campo
    )
    q2_switch_existente_nome: Optional[str] = Field(                # identificação do switch existente
        None,                                                       # opcional
        description="Nome/identificação do switch existente (quando não for novo)"  # descrição do campo
    )
    q2_observacoes: Optional[str] = Field(                          # observações específicas sobre switches
        None,                                                       # opcional
        description="Observações sobre switches / rede de acesso"   # descrição do campo
    )

    # ---------------- Quantitativo 03 – Cabeamento Óptico ----------------
    q3_tipo_fibra: Optional[str] = Field(                           # tipo de fibra (SM, OM1, OM2, etc.)
        None,                                                       # opcional
        description="Tipo de fibra óptica (SM, OM, etc.)"           # descrição do campo
    )
    q3_qtd_fibras_por_cabo: Optional[int] = Field(                  # número de fibras em cada cabo
        None,                                                       # opcional
        description="Quantidade de fibras por cabo óptico"          # descrição do campo
    )
    q3_tipo_conector: Optional[str] = Field(                        # tipo de conector (LC, SC, etc.)
        None,                                                       # opcional
        description="Tipo de conector óptico (LC, SC, etc.)"        # descrição do campo
    )
    q3_novo_dio: Optional[bool] = Field(                            # indica se haverá DIO novo
        None,                                                       # opcional
        description="Fornecer DIO novo (True/False)"                # descrição do campo
    )
    q3_caixa_terminacao: Optional[bool] = Field(                    # indica se haverá caixa de terminação óptica
        None,                                                       # opcional
        description="Caixa de terminação óptica (True/False)"       # descrição do campo
    )
    q3_caixa_emenda: Optional[bool] = Field(                        # indica se haverá caixa de emenda óptica
        None,                                                       # opcional
        description="Caixa de emenda óptica (True/False)"           # descrição do campo
    )
    q3_qtd_cabos: Optional[int] = Field(                            # quantidade total de cabos ópticos
        None,                                                       # opcional
        description="Quantidade de cabos ópticos"                   # descrição do campo
    )
    q3_tamanho_total_m: Optional[float] = Field(                    # metragem total dos cabos ópticos
        None,                                                       # opcional
        description="Tamanho total dos cabos ópticos em metros"     # descrição do campo
    )
    q3_qtd_cordoes_opticos: Optional[int] = Field(                  # quantidade de cordões ópticos
        None,                                                       # opcional
        description="Quantidade de cordões ópticos"                 # descrição do campo
    )
    q3_marca_cab_optico: Optional[str] = Field(                     # marca do cabo óptico
        None,                                                       # opcional
        description="Marca do cabeamento óptico"                    # descrição do campo
    )
    q3_modelo_dio: Optional[str] = Field(                           # modelo do DIO
        None,                                                       # opcional
        description="Modelo do DIO utilizado/fornecido"             # descrição do campo
    )
    q3_modelo_cordao_optico: Optional[str] = Field(                 # modelo dos cordões ópticos
        None,                                                       # opcional
        description="Modelo/descrição dos cordões ópticos (comprimento, tipo de conector, etc.)"  # descrição do campo
    )
    q3_observacoes: Optional[str] = Field(                          # observações gerais da parte óptica
        None,                                                       # opcional
        description="Observações sobre cabeamento óptico"           # descrição do campo
    )

    # ---------------- Quantitativo 04 – Equipamentos (Câmeras, NVR/DVR, conversor, GBIC) ----------------
    q4_camera: Optional[bool] = Field(                              # indica se o escopo inclui câmeras de CFTV
        None,                                                       # opcional
        description="Inclui câmeras de CFTV (True/False)"           # descrição do campo
    )
    q4_nvr_dvr: Optional[bool] = Field(                             # indica se inclui NVR/DVR
        None,                                                       # opcional
        description="Inclui NVR/DVR (True/False)"                   # descrição do campo
    )
    q4_camera_nova: Optional[bool] = Field(                         # indica se as câmeras são novas
        None,                                                       # opcional
        description="Câmeras novas (True) ou realocação (False)"    # descrição do campo
    )
    q4_camera_modelo: Optional[str] = Field(                        # modelo das câmeras
        None,                                                       # opcional
        description="Modelo das câmeras de CFTV"                    # descrição do campo
    )
    q4_camera_qtd: Optional[int] = Field(                           # quantidade de câmeras
        None,                                                       # opcional
        description="Quantidade de câmeras do modelo indicado"      # descrição do campo
    )
    q4_camera_fornecedor: Optional[str] = Field(                    # quem fornece as câmeras
        None,                                                       # opcional
        description="Quem fornece as câmeras: 'fornecedor_interno' ou 'cliente'"  # descrição do campo
    )
    q4_nvr_dvr_modelo: Optional[str] = Field(                       # modelo do NVR/DVR
        None,                                                       # opcional
        description="Modelo do NVR ou DVR"                          # descrição do campo
    )

    # ---------------- Quantitativo 05 – Infraestrutura ----------------
    q5_nova_eletrocalha: Optional[bool] = Field(                    # indica se será necessária nova eletrocalha
        None,                                                       # opcional
        description="Nova eletrocalha (True/False)"                 # descrição do campo
    )
    q5_novo_eletroduto: Optional[bool] = Field(                     # indica se será necessário novo eletroduto
        None,                                                       # opcional
        description="Novo eletroduto (True/False)"                  # descrição do campo
    )
    q5_novo_rack: Optional[bool] = Field(                           # indica se haverá fornecimento de rack novo
        None,                                                       # opcional
        description="Novo rack (True/False)"                        # descrição do campo
    )
    q5_instalacao_eletrica: Optional[bool] = Field(                 # indica se há instalação elétrica complementar
        None,                                                       # opcional
        description="Instalação elétrica complementar (True/False)" # descrição do campo
    )
    q5_nobreak: Optional[bool] = Field(                             # indica se inclui nobreak
        None,                                                       # opcional
        description="Inclui nobreak (True/False)"                   # descrição do campo
    )
    q5_serralheria: Optional[bool] = Field(                         # indica se serão necessários serviços de serralheria
        None,                                                       # opcional
        description="Serviços de serralheria / suportes (True/False)"  # descrição do campo
    )
    q5_eletrocalha_modelo: Optional[str] = Field(                   # modelo/descrição da eletrocalha
        None,                                                       # opcional
        description="Modelo/descrição da eletrocalha"              # descrição do campo
    )
    q5_eletrocalha_qtd: Optional[int] = Field(                      # quantidade de eletrocalhas
        None,                                                       # opcional
        description="Quantidade de eletrocalhas"                   # descrição do campo
    )
    q5_eletroduto_modelo: Optional[str] = Field(                    # modelo/descrição do eletroduto
        None,                                                       # opcional
        description="Modelo/descrição do eletroduto"              # descrição do campo
    )
    q5_eletroduto_qtd: Optional[int] = Field(                       # quantidade de eletrodutos
        None,                                                       # opcional
        description="Quantidade de eletrodutos"                   # descrição do campo
    )
    q5_rack_modelo: Optional[str] = Field(                          # modelo/descrição do rack
        None,                                                       # opcional
        description="Modelo/descrição do rack"                    # descrição do campo
    )
    q5_rack_qtd: Optional[int] = Field(                             # quantidade de racks
        None,                                                       # opcional
        description="Quantidade de racks"                          # descrição do campo
    )
    q5_nobreak_modelo: Optional[str] = Field(                       # modelo/descrição do nobreak
        None,                                                       # opcional
        description="Modelo/descrição do nobreak"                 # descrição do campo
    )
    q5_nobreak_qtd: Optional[int] = Field(                          # quantidade de nobreaks
        None,                                                       # opcional
        description="Quantidade de nobreaks"                       # descrição do campo
    )
    q5_serralheria_descricao: Optional[str] = Field(                # descrição detalhada da serralheria necessária
        None,                                                       # opcional
        description="Descrição detalhada da serralheria necessária"  # descrição do campo
    )
    q5_instalacao_eletrica_obs: Optional[str] = Field(              # observações adicionais sobre instalação elétrica
        None,                                                       # opcional
        description="Observações adicionais sobre instalação elétrica"  # descrição do campo
    )

    # ---------------- Quantitativo 09 – Análise de Painel de Automação (Controle de Acesso) ----------------
    q9_tensao_fonte: Optional[str] = Field(None, description="Tensão da fonte (12V, 24V, ou outro)")
    q9_tensao_fonte_outro: Optional[str] = Field(None, description="Valor customizado se outro")
    q9_novo_cabeamento: Optional[bool] = Field(None, description="Se será fornecido novo cabeamento")
    q9_tipo_cabeamento: Optional[str] = Field(None, description="Tipo do cabeamento (7 vias, 14 vias, outro)")
    q9_tipo_cabeamento_outro: Optional[str] = Field(None, description="Valor customizado se outro")
    q9_quantidade_metros: Optional[float] = Field(None, description="Quantidade de metros do cabeamento")

    # ---------------- Quantitativo 10 – Portas (Controle de Acesso) ----------------
    q10_tipo_porta: Optional[str] = Field(None, description="Tipo de porta (pivotante ou deslizante)")
    q10_servo_motor: Optional[bool] = Field(None, description="Servo motor (apenas para pivotante)")
    q10_servo_motor_qtd: Optional[int] = Field(None, description="Quantidade de servo motores")
    q10_ponto_eletrico_novo: Optional[bool] = Field(None, description="Precisa de ponto elétrico novo")
    q10_suporte_eletroimã: Optional[bool] = Field(None, description="Suporte para eletroímã/fechadura eletrônica")
    q10_suporte_eletroimã_qtd: Optional[int] = Field(None, description="Quantidade de suportes")
    q10_botoeira_saida: Optional[bool] = Field(None, description="Botoeira de saída")
    q10_botoeira_saida_qtd: Optional[int] = Field(None, description="Quantidade de botoeiras de saída")
    q10_botoeira_emergencia: Optional[bool] = Field(None, description="Botoeira de emergência")
    q10_botoeira_emergencia_qtd: Optional[int] = Field(None, description="Quantidade de botoeiras de emergência")
    q10_leitor_cartao: Optional[bool] = Field(None, description="Leitor de cartão")
    q10_leitor_cartao_qtd: Optional[int] = Field(None, description="Quantidade de leitores de cartão")
    q10_leitor_facial: Optional[bool] = Field(None, description="Leitor facial")
    q10_leitor_facial_qtd: Optional[int] = Field(None, description="Quantidade de leitores faciais")
    q10_sensor_presenca: Optional[bool] = Field(None, description="Sensor de presença")
    q10_sensor_presenca_qtd: Optional[int] = Field(None, description="Quantidade de sensores de presença")
    q10_sensor_barreira: Optional[bool] = Field(None, description="Sensor de barreira/segurança")
    q10_sensor_barreira_qtd: Optional[int] = Field(None, description="Quantidade de sensores de barreira")
    q9_observacoes: Optional[str] = Field(None, description="Observações adicionais sobre painel de automação")
    q10_observacoes: Optional[str] = Field(None, description="Observações adicionais sobre portas")
    q6_modelo: Optional[str] = Field(None, description="Modelo do equipamento de catraca/torniquete/cancela")
    q6_quantidade: Optional[int] = Field(None, description="Quantidade de catracas/torniquetes/cancelas")
    q6_leitor_facial: Optional[bool] = Field(None, description="Leitor facial")
    q6_leitor_facial_qtd: Optional[int] = Field(None, description="Quantidade de leitores faciais")
    q6_suporte_leitor_facial: Optional[bool] = Field(None, description="Suporte para leitor facial")
    q6_suporte_leitor_facial_qtd: Optional[int] = Field(None, description="Quantidade de suportes para leitor facial")
    q6_leitor_cartao: Optional[bool] = Field(None, description="Leitor de cartão")
    q6_leitor_cartao_qtd: Optional[int] = Field(None, description="Quantidade de leitores de cartão")
    q6_suporte_leitor_cartao: Optional[bool] = Field(None, description="Suporte para leitor de cartão")
    q6_suporte_leitor_cartao_qtd: Optional[int] = Field(None, description="Quantidade de suportes para leitor de cartão")
    q6_licenca_software: Optional[bool] = Field(None, description="Licença do software")
    q6_no_break: Optional[bool] = Field(None, description="No break")
    q6_servidor: Optional[bool] = Field(None, description="Servidor")
    q6_observacoes: Optional[str] = Field(None, description="Observações adicionais sobre catracas/torniquetes/cancelas")

    # Quantitativo 10 - Novos campos (Expansão)
    q10_eletroimã_fechadura: Optional[bool] = Field(None, description="Precisa de eletroímã/fechadura")
    q10_eletroimã_fechadura_modelo: Optional[str] = Field(None, description="Modelo do eletroímã/fechadura")
    q10_eletroimã_fechadura_qtd: Optional[int] = Field(None, description="Quantidade de eletroímãs/fechaduras")
    q10_mola_hidraulica: Optional[bool] = Field(None, description="Precisa de mola hidráulica")
    q10_mola_hidraulica_tipo: Optional[str] = Field(None, description="Tipo de mola: piso ou aérea")
    q10_mola_hidraulica_qtd: Optional[int] = Field(None, description="Quantidade de molas hidráulicas")
    q10_protecao_botoeira_emergencia_qtd: Optional[int] = Field(None, description="Quantidade de proteções para botoeira emergência")
    q10_botoeira_saida_modelo: Optional[str] = Field(None, description="Modelo da botoeira de saída")
    q10_botoeira_emergencia_modelo: Optional[str] = Field(None, description="Modelo da botoeira de emergência")
    q10_leitor_cartao_modelo: Optional[str] = Field(None, description="Modelo do leitor de cartão")
    q10_leitor_facial_modelo: Optional[str] = Field(None, description="Modelo do leitor facial")
    q10_sensor_presenca_modelo: Optional[str] = Field(None, description="Modelo do sensor de presença")
    q10_sensor_barreira_modelo: Optional[str] = Field(None, description="Modelo do sensor de barreira/segurança")

    # Quantitativo 06 - Expansão de campos
    q6_no_break_modelo: Optional[str] = Field(None, description="Modelo do no-break")
    q6_no_break_qtd: Optional[int] = Field(None, description="Quantidade de no-breaks")
    q6_servidor_modelo: Optional[str] = Field(None, description="Modelo do servidor")
    q6_servidor_qtd: Optional[int] = Field(None, description="Quantidade de servidores")

    # ---------------- Localização / Referências ----------------
    localizacao_imagem1_url: Optional[str] = Field(                 # URL ou caminho da primeira imagem de localização
        None,                                                       # opcional
        description="URL da primeira imagem de localização"         # descrição do campo
    )
    localizacao_imagem2_url: Optional[str] = Field(                 # URL ou caminho da segunda imagem de localização
        None,                                                       # opcional
        description="URL da segunda imagem de localização"          # descrição do campo
    )

    # ---------------- Pré-requisitos ----------------
    pre_trabalho_altura: Optional[bool] = Field(                    # indica se haverá trabalho em altura
        None,                                                       # opcional
        description="Trabalho em altura (True/False)"               # descrição do campo
    )
    pre_plataforma: Optional[bool] = Field(                         # indica se será necessária plataforma elevatória
        None,                                                       # opcional
        description="Necessidade de plataforma elevatória (True/False)"  # descrição do campo
    )
    pre_plataforma_modelo: Optional[str] = Field(                   # modelo/tipo da plataforma
        None,                                                       # opcional
        description="Modelo/tipo da plataforma elevatória"          # descrição do campo
    )
    pre_plataforma_dias: Optional[int] = Field(                     # quantidade de dias de uso da plataforma
        None,                                                       # opcional
        description="Quantidade de dias de uso da plataforma"       # descrição do campo
    )
    pre_fora_horario_comercial: Optional[bool] = Field(             # indica se o serviço será fora do horário comercial
        None,                                                       # opcional
        description="Serviço fora do horário comercial (True/False)"  # descrição do campo
    )
    pre_veiculo_empresa: Optional[bool] = Field(                   # indica se será necessário veículo da empresa
        None,                                                       # opcional
        description="Uso de veículo da empresa (True/False)"          # descrição do campo
    )
    pre_container_materiais: Optional[bool] = Field(                # indica se será necessário contêiner de materiais
        None,                                                       # opcional
        description="Necessidade de contêiner de materiais (True/False)"  # descrição do campo
    )

    # ---------------- Horas trabalhadas (dias normais) ----------------
    encarregado_dias: Optional[int] = Field(                        # quantidade de dias de encarregado
        None,                                                       # opcional
        description="Quantidade de dias de encarregado"             # descrição do campo
    )
    instalador_dias: Optional[int] = Field(                         # quantidade de dias de instalador
        None,                                                       # opcional
        description="Quantidade de dias de instalador"              # descrição do campo
    )
    auxiliar_dias: Optional[int] = Field(                           # quantidade de dias de auxiliar
        None,                                                       # opcional
        description="Quantidade de dias de auxiliar"                # descrição do campo
    )
    tecnico_de_instalacao_dias: Optional[int] = Field(              # quantidade de dias de técnico de instalação
        None,                                                       # opcional
        description="Quantidade de dias de técnico de instalação"   # descrição do campo
    )
    tecnico_em_seguranca_dias: Optional[int] = Field(               # quantidade de dias de técnico em segurança
        None,                                                       # opcional
        description="Quantidade de dias de técnico em segurança"    # descrição do campo
    )

    # ---------------- Horas extras ----------------
    encarregado_hora_extra: Optional[int] = Field(                  # horas extras de encarregado
        None,                                                       # opcional
        description="Horas extras de encarregado"                   # descrição do campo
    )
    instalador_hora_extra: Optional[int] = Field(                   # horas extras de instalador
        None,                                                       # opcional
        description="Horas extras de instalador"                    # descrição do campo
    )
    auxiliar_hora_extra: Optional[int] = Field(                     # horas extras de auxiliar
        None,                                                       # opcional
        description="Horas extras de auxiliar"                      # descrição do campo
    )
    tecnico_de_instalacao_hora_extra: Optional[int] = Field(        # horas extras de técnico de instalação
        None,                                                       # opcional
        description="Horas extras de técnico de instalação"         # descrição do campo
    )
    tecnico_em_seguranca_hora_extra: Optional[int] = Field(         # horas extras de técnico em segurança
        None,                                                       # opcional
        description="Horas extras de técnico em segurança"          # descrição do campo
    )

    # ---------------- Trabalho em domingos/feriados ----------------
    encarregado_trabalho_domingo: Optional[int] = Field(            # domingos/feriados trabalhados pelo encarregado
        None,                                                       # opcional
        description="Domingos/feriados trabalhados pelo encarregado"  # descrição do campo
    )
    instalador_trabalho_domingo: Optional[int] = Field(             # domingos/feriados trabalhados pelo instalador
        None,                                                       # opcional
        description="Domingos/feriados trabalhados pelo instalador"  # descrição do campo
    )
    auxiliar_trabalho_domingo: Optional[int] = Field(               # domingos/feriados trabalhados pelo auxiliar
        None,                                                       # opcional
        description="Domingos/feriados trabalhados pelo auxiliar"   # descrição do campo
    )
    tecnico_de_instalacao_trabalho_domingo: Optional[int] = Field(  # domingos/feriados trabalhados pelo técnico de instalação
        None,                                                       # opcional
        description="Domingos/feriados trabalhados pelo técnico de instalação"  # descrição do campo
    )
    tecnico_em_seguranca_trabalho_domingo: Optional[int] = Field(   # domingos/feriados trabalhados pelo técnico em segurança
        None,                                                       # opcional
        description="Domingos/feriados trabalhados pelo técnico em segurança"  # descrição do campo
    )

    # ---------------- Alimentação ----------------
    almoco_qtd: Optional[int] = Field(                              # quantidade estimada de almoços
        None,                                                       # opcional
        description="Quantidade estimada de almoços"                # descrição do campo
    )
    lanche_qtd: Optional[int] = Field(                              # quantidade estimada de lanches
        None,                                                       # opcional
        description="Quantidade estimada de lanches"                # descrição do campo
    )

    # ---------------- Cronograma e prazos ----------------
    cronograma_execucao: Optional[bool] = Field(                    # indica se haverá cronograma formal de execução
        None,                                                       # opcional
        description="Cronograma formal de execução (True/False)"    # descrição do campo
    )
    dias_instalacao: Optional[int] = Field(                         # quantidade estimada de dias de instalação
        None,                                                       # opcional
        description="Quantidade estimada de dias de instalação"     # descrição do campo
    )
    as_built: Optional[bool] = Field(                               # indica se será entregue documentação As Built
        None,                                                       # opcional
        description="Entrega de documentação As Built (True/False)" # descrição do campo
    )
    dias_entrega_relatorio: Optional[int] = Field(                  # prazo em dias para entrega de relatório/As Built
        None,                                                       # opcional
        description="Prazo em dias para entrega de relatório / As Built"  # descrição do campo
    )
    art: Optional[bool] = Field(                                    # indica se será emitida ART
        None,                                                       # opcional
        description="Emissão de ART (True/False)"                   # descrição do campo
    )

    # ---------------- Materiais do Painel (Q9) ----------------
    materiais_painel: Optional[List[MaterialPainelOutSchema]] = Field(  # lista de materiais do painel
        None,                                                       # opcional
        description="Lista de materiais do painel de automação"     # descrição do campo
    )

    # ---------------- Metadados ----------------
    criado_em: Optional[datetime] = Field(                          # data/hora de criação do registro no banco
        None,                                                       # opcional (pode vir nulo em alguns contextos)
        description="Data/hora de criação da avaliação"             # descrição do campo
    )
    atualizado_em: Optional[datetime] = Field(                      # data/hora da última atualização do registro
        None,                                                       # opcional
        description="Data/hora da última atualização da avaliação"  # descrição do campo
    )

    class Config:                                                   # configuração interna do Pydantic
        orm_mode = True                                             # permite criar esse schema direto a partir de objetos ORM do SQLAlchemy

class AvaliacaoAuditoriaOutSchema(BaseModel):                    # schema de saída para auditoria
    id: int                                                      # id do registro de auditoria
    avaliacao_id: int                                            # id da avaliação associada
    usuario: Optional[str]                                       # usuário que fez a ação
    acao: str                                                    # tipo de ação
    detalhes: Optional[str]                                      # detalhes em texto
    data_hora: Optional[datetime]                                # data/hora da ação (datetime, não string)

    class Config:                                                # configuração do Pydantic
        orm_mode = True                                          # permite ler de objeto ORM

class UsuarioAuditoriaOutSchema(BaseModel):                         # schema de saída para listar registros de auditoria de usuários
    id: int                                                         # id do registro de auditoria
    usuario_alvo_id: int                                            # id do usuário que sofreu a ação
    usuario_acao_id: Optional[int]                                  # id do usuário que executou a ação (pode ser None)
    acao: str                                                       # tipo de ação executada
    detalhes: Optional[str]                                         # detalhes extras em texto/JSON
    data_hora: Optional[datetime]                                   # data e hora em que a ação aconteceu

    class Config:                                                   # configuração do Pydantic
        orm_mode = True                                             # permite criar o schema a partir de objetos ORM do SQLAlchemy

class EquipamentoBaseSchema(BaseModel):                           # schema base para criação de equipamento
    equipamento: str = Field(                                     # nome do equipamento
        ...,                                                      # obrigatório
        description="Nome do equipamento"                         # descrição exibida no Swagger
    )
    modelo: Optional[str] = Field(                                # modelo do equipamento
        None,                                                     # opcional
        description="Modelo do equipamento"                       # descrição no Swagger
    )
    quantidade: int = Field(                                      # quantidade do equipamento
        ...,                                                      # obrigatório
        ge=1,                                                     # mínimo 1
        description="Quantidade do equipamento"                   # descrição no Swagger
    )
    fabricante: Optional[str] = Field(                            # fabricante do equipamento
        None,                                                     # opcional
        description="Fabricante do equipamento"                   # descrição no Swagger
    )

    class Config:                                                 # configurações do Pydantic
        orm_mode = True                                           # permite converter a partir de objetos ORM


class EquipamentoOutSchema(EquipamentoBaseSchema):                # schema de saída para equipamento
    id: int = Field(..., description="ID do equipamento")         # identificador único do equipamento
    avaliacao_id: int = Field(..., description="ID da avaliação") # id da avaliação relacionada

class ImagemBaseSchema(BaseModel):                                # schema base para criação/edição de imagem de avaliação
    contexto: str = Field(                                        # contexto da imagem (qual seção ela representa)
        ...,                                                      # obrigatório
        description="Contexto da imagem (ex.: switch, localizacao, q4_cameras)"  # ajuda na documentação do Swagger
    )
    ordem: int = Field(                                           # ordem de exibição da imagem no contexto
        ...,                                                      # obrigatório
        ge=1,                                                     # garante que a ordem seja pelo menos 1
        description="Ordem de exibição da imagem dentro do contexto"  # descrição exibida no Swagger
    )
    url: str = Field(                                             # URL pública/caminho da imagem
        ...,                                                      # obrigatório
        description="URL pública ou caminho da imagem salva"      # instrução para o consumidor da API
    )
    descricao: Optional[str] = Field(                             # texto descritivo ligado à imagem
        None,                                                     # opcional (pode ficar em branco)
        description="Descrição ou observações sobre a imagem"     # texto de ajuda exibido no Swagger
    )

    class Config:                                                 # configurações do Pydantic
        orm_mode = True                                           # permite converter diretamente a partir de objetos ORM


class ImagemOutSchema(ImagemBaseSchema):                          # schema de saída para imagem de avaliação
    id: int = Field(..., description="ID da imagem")              # identificador único da imagem no banco
    avaliacao_id: int = Field(..., description="ID da avaliação") # id da avaliação à qual a imagem pertence

class OutroRecursoBaseSchema(BaseModel):                          # schema base para criação de outro recurso
    descricao: str = Field(                                       # descrição do recurso
        ...,                                                      # obrigatório
        description="Descrição do recurso (ex.: Almoço, Lanche)"  # descrição exibida no Swagger
    )
    quantidade: int = Field(                                      # quantidade do recurso
        ...,                                                      # obrigatório
        ge=1,                                                     # mínimo 1
        description="Quantidade do recurso"                       # descrição no Swagger
    )

    class Config:                                                 # configurações do Pydantic
        orm_mode = True                                           # permite converter a partir de objetos ORM

class OutroRecursoOutSchema(OutroRecursoBaseSchema):              # schema de saída para outro recurso
    id: int = Field(..., description="ID do recurso")             # identificador único do recurso
    avaliacao_id: int = Field(..., description="ID da avaliação") # id da avaliação relacionada


# -----------------------------------------------------------
# Criação da aplicação FastAPI
# -----------------------------------------------------------
app = FastAPI(                                                   # instancia a aplicação FastAPI
    title="API Avaliação Técnica de Instalações",                # título da API
    description="API para registrar e auditar avaliações técnicas de instalações.",  # descrição da API
    version="0.1.0"                                              # versão inicial da API
)

# -----------------------------------------------------------
# Configuração de CORS (para permitir o front do Netlify acessar a API)
# O conjunto de origens pode ser configurado via variável de ambiente
# ALLOWED_ORIGINS como lista separada por vírgula. Ex:
# ALLOWED_ORIGINS="https://quotation-evaluation.netlify.app,https://meu-outro-front.local"
# -----------------------------------------------------------
_origins_env = os.getenv("ALLOWED_ORIGINS")
if _origins_env:
    origins = [o.strip() for o in _origins_env.split(",") if o.strip()]
else:
    origins = [
        "http://localhost:8000",  # origem quando o front é servido pelo próprio FastAPI em desenvolvimento
        "http://127.0.0.1:8000",  # variação com IP local
        "https://quotation-evaluation.netlify.app",  # origem EXATA do frontend em produção
        "http://quotation-evaluation.netlify.app",  # versão HTTP (Netlify pode servir ambas)
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")  # expõe o diretório de uploads na rota /uploads para servir os arquivos salvos

# -----------------------------------------------------------
# Arquivos estáticos e rota raiz (para uso local / testes)
# -----------------------------------------------------------
app.mount(                                                       # registra uma rota de arquivos estáticos
    "/static",                                                   # prefixo de URL onde os arquivos ficarão acessíveis
    StaticFiles(directory="static"),                             # aponta para a pasta local "static" (CSS, JS, imagens)
    name="static",                                               # nome interno desse mount, usado apenas pelo FastAPI
)

@app.get("/")                                                    # define a rota GET para a raiz do site ("/")
def servir_frontend() -> FileResponse:                           # função chamada quando acessamos a raiz
    return FileResponse("index.html")                            # devolve o arquivo index.html na raiz do projeto (opção B que você escolheu)

# -----------------------------------------------------------
# Rota de saúde (opcional, só para testar se está no ar)
# -----------------------------------------------------------
@app.get("/health")                                              # define rota GET /health
def health_check():                                              # função que será executada nessa rota
    return {"status": "ok"}                                      # retorna JSON simples com status ok

# -----------------------------------------------------------
# Endpoint: login (gera token JWT)
# -----------------------------------------------------------
@app.post("/auth/login",                                        # rota POST /auth/login
          response_model=TokenSchema)                           # resposta no formato TokenSchema
async def login(                                                # função assíncrona para realizar login
    form_data: OAuth2PasswordRequestForm = Depends(),           # recebe username e password via formulário padrão OAuth2
    db: Session = Depends(get_db)                               # sessão de banco injetada
):
    usuario = autenticar_usuario(                               # tenta autenticar o usuário
        db,                                                     # sessão de banco
        form_data.username,                                     # login informado
        form_data.password                                      # senha digitada
    )
    if not usuario:                                             # se autenticação falhar
        raise HTTPException(                                    # lança erro 400
            status_code=400,
            detail="Usuário ou senha incorretos."               # mensagem genérica
        )

    expira = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)     # calcula tempo de expiração do token
    access_token = criar_token_acesso(                          # gera o token JWT
        dados={"sub": usuario.username},                        # define o "subject" (usuário) do token
        expira_em=expira                                        # tempo de expiração
    )

    return {                                                    # retorna o token e o tipo
        "access_token": access_token,
        "token_type": "bearer"
    }

# -----------------------------------------------------------
# Endpoint: dados do usuário logado
# -----------------------------------------------------------
@app.get("/auth/me",                                            # rota GET /auth/me
         response_model=UsuarioMeSchema)                        # resposta com dados do usuário
async def obter_me(                                             # função para retornar o usuário atual
    usuario: Usuario = Depends(obter_usuario_atual)             # obtém usuário atual a partir do token
):
    return usuario                                              # retorna o objeto usuário (convertido pelo Pydantic)

# -----------------------------------------------------------
# Endpoint: troca de senha (usuário logado)
# -----------------------------------------------------------
@app.post("/auth/trocar-senha")                                 # rota POST /auth/trocar-senha
async def trocar_senha(                                         # função para alteração de senha
    payload: TrocarSenhaSchema,                                 # corpo da requisição com senha atual e nova
    db: Session = Depends(get_db),                              # sessão de banco
    usuario: Usuario = Depends(obter_usuario_atual)             # usuário atual obtido pelo token
):
    if not verificar_senha(payload.senha_atual, usuario.senha_hash):  # verifica se a senha atual confere
        raise HTTPException(                                    # se não conferir, erro 400
            status_code=400,
            detail="Senha atual incorreta."
        )

    usuario.senha_hash = gerar_hash_senha(payload.nova_senha)     # atualiza o hash da senha do usuário com a nova senha digitada
    usuario.precisa_trocar_senha = False                          # remove a obrigatoriedade de trocar senha (já foi trocada)
    db.add(usuario)                                               # garante que o objeto usuário está anexado à sessão
    db.commit()                                                   # grava a alteração da senha no banco

    detalhes_log = json.dumps({                                   # monta um dicionário simples com informações para o log
        "acao": "TROCAR_SENHA",                                   # tipo da ação
        "usuario": usuario.username                               # login do usuário que trocou a senha
    }, ensure_ascii=False)                                        # mantém os caracteres especiais corretamente

    registrar_auditoria_usuario(                                  # registra a auditoria da troca de senha
        db=db,                                                    # sessão de banco atual
        usuario_alvo_id=usuario.id,                               # o próprio usuário é o alvo da ação
        acao="TROCAR_SENHA",                                      # código da ação
        detalhes=detalhes_log,                                    # detalhes em JSON
        usuario_responsavel=usuario                               # o usuário responsável pela ação é ele mesmo
    )
    db.commit()                                                   # commit final para salvar o registro de auditoria

    return {"detail": "Senha alterada com sucesso."}              # responde ao cliente informando o sucesso da operação

# -----------------------------------------------------------
# Endpoint: criar novo usuário (apenas admin)
# -----------------------------------------------------------
@app.post("/usuarios",                                          # rota POST /usuarios
          response_model=UsuarioBaseSchema)                     # responde com dados do usuário criado
async def criar_usuario(                                        # função para criar um novo usuário
    payload: UsuarioCreateSchema,                               # dados do novo usuário
    db: Session = Depends(get_db),                              # sessão de banco
    admin: Usuario = Depends(obter_admin_atual)                 # garante que quem chama é admin
):
    # Verifica se já existe usuário com mesmo username ou e-mail
    existente = db.query(Usuario).filter(                       # busca por conflito de login/e-mail
        (Usuario.username == payload.username) |                # mesmo username
        (Usuario.email == payload.email)                        # ou mesmo e-mail
    ).first()
    if existente:                                               # se encontrou conflito
        raise HTTPException(                                    # erro 400
            status_code=400,
            detail="Já existe usuário com esse login ou e-mail."
        )

    novo_usuario = Usuario(                                     # cria novo objeto Usuario com base nos dados recebidos
        nome=payload.nome,                                      # define o nome completo a partir do payload
        email=payload.email,                                    # define o e-mail a partir do payload
        username=payload.username,                              # define o login de acesso
        senha_hash=gerar_hash_senha(payload.senha),             # gera o hash seguro da senha inicial
        is_admin=(payload.role == "admin" or payload.is_admin), # sincroniza is_admin com role (compatibilidade)
        role=payload.role,                                      # define a role do usuário
        precisa_trocar_senha=True                               # obriga troca de senha no primeiro login
    )

    db.add(novo_usuario)                                        # adiciona novo usuário na sessão
    db.commit()                                                 # grava no banco
    db.refresh(novo_usuario)                                    # atualiza o objeto com dados do banco (id, etc.)

    detalhes_log = json.dumps({                                   # monta um dicionário com alguns dados do usuário criado para salvar no log
        "acao": "CRIAR_USUARIO",                                  # identifica o tipo de ação registrada
        "nome": novo_usuario.nome,                                # nome do usuário criado
        "email": novo_usuario.email,                              # e-mail do usuário criado
        "username": novo_usuario.username                         # login do usuário criado
    }, ensure_ascii=False)                                        # garante que acentos e caracteres especiais sejam mantidos corretamente

    registrar_auditoria_usuario(                                  # chama o helper para registrar a auditoria dessa ação
        db=db,                                                    # passa a sessão de banco atual
        usuario_alvo_id=novo_usuario.id,                          # id do usuário que acabou de ser criado
        acao="CRIAR_USUARIO",                                     # código da ação
        detalhes=detalhes_log,                                    # detalhes em JSON
        usuario_responsavel=admin                                 # usuário responsável pela ação (o admin logado)
    )
    db.commit()                                                   # faz um novo commit para gravar o registro de auditoria

    return novo_usuario                                         # retorna o usuário criado

# -----------------------------------------------------------
# Endpoint: listar usuários (apenas admin)
# -----------------------------------------------------------
@app.get("/usuarios",                                           # rota GET /usuarios para listar todos os usuários
         response_model=List[UsuarioBaseSchema])                # resposta será uma lista de usuários no formato base
async def listar_usuarios(                                      # função assíncrona para listar usuários
    db: Session = Depends(get_db),                              # injeta sessão de banco de dados
    admin: Usuario = Depends(obter_admin_atual)                 # garante que apenas administradores possam acessar a lista
):
    usuarios = db.query(Usuario).order_by(Usuario.id.asc()).all()  # busca todos os usuários ordenando pelo id crescente
    return usuarios                                             # retorna a lista de usuários

# -----------------------------------------------------------
# Endpoint: ativar/desativar usuário (apenas admin)
# -----------------------------------------------------------
@app.patch("/usuarios/{usuario_id}/status",                     # rota PATCH para alterar o campo "ativo" de um usuário
           response_model=UsuarioBaseSchema)                    # responde com o usuário atualizado
async def atualizar_status_usuario(                             # função assíncrona para atualizar o status de um usuário
    usuario_id: int,                                            # id do usuário recebido na URL
    payload: UsuarioStatusUpdateSchema,                         # corpo da requisição com o novo valor de "ativo"
    db: Session = Depends(get_db),                              # sessão de banco injetada pelo FastAPI
    admin: Usuario = Depends(obter_admin_atual)                 # usuário logado, garantido como administrador
):
    usuario = db.query(Usuario).filter(                         # monta consulta na tabela de usuários
        Usuario.id == usuario_id                                # filtra pelo id informado na rota
    ).first()                                                   # obtém o primeiro resultado (ou None)

    if not usuario:                                             # se nenhum usuário foi encontrado
        raise HTTPException(                                    # lança erro HTTP
            status_code=404,                                    # código 404 - não encontrado
            detail="Usuário não encontrado."                    # mensagem explicando o problema
        )

    if usuario.id == admin.id and not payload.ativo:            # se o admin tentar desativar o próprio usuário logado
        raise HTTPException(                                    # lança erro HTTP
            status_code=400,                                    # código 400 - requisição inválida
            detail="Você não pode desativar o próprio usuário logado."  # motivo da restrição
        )

    usuario.ativo = payload.ativo                               # aplica o novo valor de "ativo" ao usuário
    db.add(usuario)                                             # adiciona o objeto usuário na sessão de banco
    db.commit()                                                 # grava a alteração no banco
    db.refresh(usuario)                                         # recarrega o objeto usuário com os dados atualizados

    acao = "ATIVAR_USUARIO" if usuario.ativo else "DESATIVAR_USUARIO"  # define o código da ação conforme o novo status

    detalhes_log = json.dumps({                                 # monta o JSON com detalhes para o log
        "acao": acao,                                           # tipo de ação (ATIVAR_USUARIO ou DESATIVAR_USUARIO)
        "usuario_alvo": usuario.username                        # login do usuário afetado pela ação
    }, ensure_ascii=False)                                      # mantém acentuação corretamente

    registrar_auditoria_usuario(                                # registra a ação na tabela de auditoria de usuários
        db=db,                                                  # sessão de banco atual
        usuario_alvo_id=usuario.id,                             # id do usuário que sofreu a ação
        acao=acao,                                              # código da ação (ATIVAR_USUARIO ou DESATIVAR_USUARIO)
        detalhes=detalhes_log,                                  # detalhes em JSON
        usuario_responsavel=admin                               # aqui usamos o admin logado, NÃO Depends(...)
    )
    db.commit()                                                 # faz commit para gravar o registro de auditoria

    return usuario                                              # retorna o usuário atualizado para o cliente

# -----------------------------------------------------------
# Endpoint: alterar role de usuário (apenas admin)
# -----------------------------------------------------------
@app.patch("/usuarios/{usuario_id}/role",                       # rota PATCH para alterar o role de um usuário
           response_model=UsuarioBaseSchema)                    # responde com o usuário atualizado
async def atualizar_role_usuario(                               # função assíncrona para atualizar o role
    usuario_id: int,                                            # id do usuário recebido na URL
    payload: UsuarioRoleUpdateSchema,                           # corpo da requisição com o novo role
    db: Session = Depends(get_db),                              # sessão de banco injetada pelo FastAPI
    admin: Usuario = Depends(obter_admin_atual)                 # usuário logado, garantido como administrador
):
    # Valida se o role informado é válido
    roles_validos = ["admin", "avaliador", "comercial", "visualizador"]       # lista de roles permitidos
    if payload.role not in roles_validos:                       # se o role não está na lista
        raise HTTPException(                                    # lança erro HTTP
            status_code=400,                                    # código 400 - requisição inválida
            detail=f"Role inválido. Use: {', '.join(roles_validos)}"  # mensagem com roles válidos
        )

    usuario = db.query(Usuario).filter(                         # monta consulta na tabela de usuários
        Usuario.id == usuario_id                                # filtra pelo id informado na rota
    ).first()                                                   # obtém o primeiro resultado (ou None)

    if not usuario:                                             # se nenhum usuário foi encontrado
        raise HTTPException(                                    # lança erro HTTP
            status_code=404,                                    # código 404 - não encontrado
            detail="Usuário não encontrado."                    # mensagem explicando o problema
        )

    # Protege o usuário "admin" padrão contra alterações de role
    if usuario.username == "admin":                             # se for o usuário admin padrão do sistema
        raise HTTPException(                                    # lança erro HTTP
            status_code=403,                                    # código 403 - proibido
            detail="O usuário admin padrão não pode ter seu perfil alterado."  # motivo da restrição
        )

    role_anterior = usuario.role                                # guarda o role anterior para o log
    usuario.role = payload.role                                 # aplica o novo role
    usuario.is_admin = (payload.role == "admin")                # sincroniza is_admin com o role
    db.add(usuario)                                             # adiciona o objeto usuário na sessão
    db.commit()                                                 # grava a alteração no banco
    db.refresh(usuario)                                         # recarrega o objeto usuário

    detalhes_log = json.dumps({                                 # monta o JSON com detalhes para o log
        "acao": "ALTERAR_ROLE",                                 # tipo de ação
        "usuario_alvo": usuario.username,                       # login do usuário afetado
        "role_anterior": role_anterior,                         # role antes da alteração
        "role_novo": payload.role                               # novo role aplicado
    }, ensure_ascii=False)                                      # mantém acentuação corretamente

    registrar_auditoria_usuario(                                # registra a ação na tabela de auditoria
        db=db,                                                  # sessão de banco atual
        usuario_alvo_id=usuario.id,                             # id do usuário que sofreu a ação
        acao="ALTERAR_ROLE",                                    # código da ação
        detalhes=detalhes_log,                                  # detalhes em JSON
        usuario_responsavel=admin                               # admin logado
    )
    db.commit()                                                 # grava o registro de auditoria

    return usuario                                              # retorna o usuário atualizado

# -----------------------------------------------------------
# Endpoint: resetar senha de usuário (apenas admin)
# -----------------------------------------------------------
@app.post("/usuarios/{usuario_id}/resetar-senha")               # rota POST /usuarios/{id}/resetar-senha
async def resetar_senha_usuario(                                # função assíncrona para resetar a senha de um usuário
    usuario_id: int,                                            # id do usuário recebido na URL
    db: Session = Depends(get_db),                              # sessão de banco injetada
    admin: Usuario = Depends(obter_admin_atual)                 # garante que apenas administradores executem a ação
):
    usuario = db.query(Usuario).filter(                         # consulta a tabela de usuários
        Usuario.id == usuario_id                                # filtra pelo id informado
    ).first()                                                   # obtém o primeiro resultado (ou None)

    if not usuario:                                             # se o usuário não foi encontrado
        raise HTTPException(                                    # lança exceção HTTP
            status_code=404,                                    # código 404 - não encontrado
            detail="Usuário não encontrado."                    # mensagem explicando o problema
        )

    #senha_temporaria = gerar_senha_temporaria(10)               # gera uma nova senha temporária com 10 caracteres
    senha_temporaria = "123456"
    usuario.senha_hash = gerar_hash_senha(senha_temporaria)     # atualiza o hash de senha com a nova senha temporária
    usuario.precisa_trocar_senha = True                         # força o usuário a trocar a senha no próximo login
    usuario.ativo = True                                        # garante que o usuário esteja ativo após o reset de senha
    db.add(usuario)                                             # adiciona o usuário modificado na sessão
    db.commit()                                                 # grava as alterações no banco

    detalhes_log = json.dumps({                                   # monta detalhes específicos da ação executada
        "acao": "RESET_SENHA",                              # ajuste para ATIVAR_USUARIO ou RESET_SENHA conforme o caso
        "usuario_alvo": usuario.username                          # login do usuário afetado
    }, ensure_ascii=False)                                        # mantém acentos corretamente

    registrar_auditoria_usuario(                                  # registra a auditoria dessa operação
        db=db,                                                    # sessão de banco
        usuario_alvo_id=usuario.id,                               # id do usuário alvo da ação
        acao="RESET_SENHA",                                 # ajuste para o código correto da ação
        detalhes=detalhes_log,                                    # detalhes em JSON
        usuario_responsavel=admin               # passe o usuário responsável (ex.: admin da dependência)
    )
    db.commit()                                                   # commit para gravar o log de auditoria


    return {                                                    # retorna um JSON com informações da operação
        "detail": "Senha temporária gerada com sucesso.",       # mensagem de confirmação da ação
        "senha_temporaria": senha_temporaria                    # senha temporária para o administrador informar ao usuário
    }                                          # devolve a lista de usuários para o cliente

# -----------------------------------------------------------
# Endpoint: criar nova avaliação (POST /avaliacoes)
# -----------------------------------------------------------
@app.post("/avaliacoes",                                         # define rota POST /avaliacoes
          response_model=AvaliacaoOutSchema)                     # define o schema de resposta
def criar_avaliacao(                                             # função para criar avaliação
    payload: AvaliacaoCreateSchema,                              # dados recebidos no corpo da requisição (já parseados pelo Pydantic)
    db: Session = Depends(get_db),                              # sessão de banco injetada pela dependência
    usuario: Usuario = Depends(obter_usuario_atual)             # usuário autenticado
):
    # Neste ponto, payload.data_avaliacao já é um objeto date,    # comentário explicand
    # porque tipamos o campo como date no schema.                 # reforço da compatibilidade com a coluna Date do SQLAlchemy

    codigo_avaliacao = gerar_codigo_avaliacao(                      # chama helper para gerar o código amigável da nova avaliação
        db=db,                                                      # passa a sessão de banco atual para que a função consulte registros existentes
        data_avaliacao=payload.data_avaliacao                       # passa a data da avaliação para compor o ano do código (AVTAAAAxxx)
    )                                                               # ao final, teremos uma string no formato "AVT2025001", por exemplo

    # Bloqueia usuários Visualizador de criar avaliações
    if usuario and getattr(usuario, 'role', None) == 'visualizador':
        raise HTTPException(status_code=403, detail="Usuário Visualizador não tem permissão para criar avaliações.")

    avaliacao = Avaliacao(                                           # instancia um novo objeto Avaliacao
        usuario_id=usuario.id,                                       # ID do usuário criador da avaliação (usuário autenticado)
        codigo_avaliacao=codigo_avaliacao,                           # atribui o código amigável gerado (ex.: AVT2025001) à nova avaliação
        cliente_nome=payload.cliente_nome,                           # nome do cliente
        data_avaliacao=payload.data_avaliacao,                       # data da avaliação (já é date)
        local=payload.local,                                         # local da instalação
        objeto=payload.objeto,                                       # objeto da avaliação
        status=payload.status or "aberto",                           # status, com fallback para "aberto"
        equipe=payload.equipe,                                       # equipe responsável
        responsavel_avaliacao=payload.responsavel_avaliacao,         # responsável técnico pela avaliação
        #tipo_formulario
        tipo_formulario=payload.tipo_formulario,                     # tipo de formulário (redes, infraestrutura, etc.)
        #tipo_formulario
        contato=payload.contato,                                     # contato do cliente
        email_cliente=payload.email_cliente,                         # e-mail do cliente
        escopo_texto=payload.escopo_texto,                           # texto do escopo da avaliação

        # ====== Campos gerais de serviço (fora MC / intermediário) ======
        servico_fora_montes_claros=payload.servico_fora_montes_claros,   # flag se serviço é fora de Montes Claros
        servico_intermediario=payload.servico_intermediario,             # flag se serviço é para intermediário/empreiteira

        # ====== Quantitativo 01 – Patch Panel ======
        q1_categoria_cab=payload.q1_categoria_cab,                        # categoria do cabeamento (Cat5e/Cat6/Cat6a)
        q1_blindado=payload.q1_blindado,                                  # se o cabeamento é blindado (STP/UTP)
        q1_novo_patch_panel=payload.q1_novo_patch_panel,                  # indica se será fornecido novo patch panel
        q1_incluir_guia=payload.q1_incluir_guia,                          # indica se devem ser incluídas guias de cabos
        q1_qtd_pontos_rede=payload.q1_qtd_pontos_rede,                    # quantidade de pontos de rede previstos
        q1_qtd_cabos=payload.q1_qtd_cabos,                                # quantidade de cabos UTP previstos
        q1_qtd_portas_patch_panel=payload.q1_qtd_portas_patch_panel,      # quantidade de portas do patch panel
        q1_qtd_patch_cords=payload.q1_qtd_patch_cords,                    # quantidade de patch cords previstos
        q1_marca_cab=payload.q1_marca_cab,                 # marca do cabeamento UTP a ser usado (CommScope, Furukawa ou "Outro: <texto>")
        q1_modelo_patch_panel=payload.q1_modelo_patch_panel,              # modelo/descrição do patch panel (fabricante, nº de portas, etc.)
        q1_qtd_guias_cabos=payload.q1_qtd_guias_cabos,                    # quantidade de guias de cabos a instalar
        q1_patch_cords_modelo=payload.q1_patch_cords_modelo,              # modelo/descrição dos patch cords (categoria, comprimento, etc.)
        q1_patch_cords_cor=payload.q1_patch_cords_cor,                    # cor ou cores dos patch cords
        q1_patch_panel_existente_nome=payload.q1_patch_panel_existente_nome,  # identificação do patch panel existente, quando não for fornecido novo

        # ====== Quantitativo 02 – Switch ======
        q2_novo_switch=payload.q2_novo_switch,                       # indica se haverá fornecimento de switch novo
        q2_fornecedor_switch=payload.q2_fornecedor_switch,           # quem fornece o switch: 'fornecedor_interno' ou 'cliente'
        q2_modelo_switch=payload.q2_modelo_switch,                   # modelo do switch (novo ou existente)
        q2_switch_foto_url=payload.q2_switch_foto_url,               # URL ou caminho da foto do switch existente
        q2_observacoes=payload.q2_observacoes,                       # observações gerais sobre o(s) switch(es)

        # ====== Quantitativo 03 – Cabeamento Óptico ======
        q3_tipo_fibra=payload.q3_tipo_fibra,                         # tipo de fibra (SM, OM1, OM3...)
        q3_qtd_fibras_por_cabo=payload.q3_qtd_fibras_por_cabo,       # quantas fibras por cabo (02F, 04F, etc.)
        q3_tipo_conector=payload.q3_tipo_conector,                   # tipo de conector (LC, SC, ST, MTRJ)
        q3_novo_dio=payload.q3_novo_dio,                             # se precisa de DIO novo
        q3_caixa_terminacao=payload.q3_caixa_terminacao,             # se precisa de caixa de terminação
        q3_caixa_emenda=payload.q3_caixa_emenda,                     # se precisa de caixa de emenda
        q3_qtd_cabos=payload.q3_qtd_cabos,                           # quantidade de cabos ópticos previstos
        q3_tamanho_total_m=payload.q3_tamanho_total_m,               # metragem total estimada dos cabos ópticos (em metros)
        q3_qtd_cordoes_opticos=payload.q3_qtd_cordoes_opticos,       # quantidade de cordões ópticos
        q3_marca_cab_optico=payload.q3_marca_cab_optico,             # marca do cabeamento óptico
        q3_modelo_dio=payload.q3_modelo_dio,                         # modelo/descrição do DIO
        q3_modelo_cordao_optico=payload.q3_modelo_cordao_optico,     # modelo/descrição dos cordões ópticos
        q3_observacoes=payload.q3_observacoes,                       # observações gerais sobre o cabeamento óptico

        # ====== Quantitativo 04 – Equipamentos (Câmeras / NVR/DVR / Conversor / GBIC) ======
        q4_camera=payload.q4_camera,                                 # indica se a avaliação envolve câmeras de CFTV
        q4_nvr_dvr=payload.q4_nvr_dvr,                               # indica se haverá NVR ou DVR
        q4_camera_nova=payload.q4_camera_nova,                       # True = câmeras novas, False = realocação
        q4_camera_modelo=payload.q4_camera_modelo,                   # modelo das câmeras de CFTV
        q4_camera_qtd=payload.q4_camera_qtd,                         # quantidade de câmeras do modelo informado
        q4_camera_fornecedor=payload.q4_camera_fornecedor,           # quem fornece as câmeras: 'fornecedor_interno' ou 'cliente'
        q4_nvr_dvr_modelo=payload.q4_nvr_dvr_modelo,                 # modelo/descrição do NVR/DVR

        # ====== Quantitativo 05 – Infraestrutura ======
        q5_nova_eletrocalha=payload.q5_nova_eletrocalha,             # indica se haverá nova eletrocalha
        q5_novo_eletroduto=payload.q5_novo_eletroduto,               # indica se haverá novo eletroduto
        q5_novo_rack=payload.q5_novo_rack,                           # indica se haverá novo rack
        q5_instalacao_eletrica=payload.q5_instalacao_eletrica,       # indica se haverá adequação/instalação elétrica
        q5_nobreak=payload.q5_nobreak,                               # indica se haverá fornecimento de nobreak
        q5_serralheria=payload.q5_serralheria,                       # indica se haverá serviços de serralheria/suportes
        q5_eletrocalha_modelo=payload.q5_eletrocalha_modelo,         # modelo/descrição da eletrocalha
        q5_eletrocalha_qtd=payload.q5_eletrocalha_qtd,               # quantidade de eletrocalhas
        q5_eletroduto_modelo=payload.q5_eletroduto_modelo,           # modelo/descrição do eletroduto
        q5_eletroduto_qtd=payload.q5_eletroduto_qtd,                 # quantidade de eletrodutos
        q5_rack_modelo=payload.q5_rack_modelo,                       # modelo/descrição do rack
        q5_rack_qtd=payload.q5_rack_qtd,                             # quantidade de racks
        q5_nobreak_modelo=payload.q5_nobreak_modelo,                 # modelo/descrição do nobreak
        q5_nobreak_qtd=payload.q5_nobreak_qtd,                       # quantidade de nobreaks
        q5_serralheria_descricao=payload.q5_serralheria_descricao,   # descrição detalhada da serralheria necessária
        q5_instalacao_eletrica_obs=payload.q5_instalacao_eletrica_obs, # observações adicionais sobre instalação elétrica

        # ====== Localização / imagens de referência ======
        localizacao_imagem1_url=payload.localizacao_imagem1_url,     # URL da primeira imagem de referência
        localizacao_imagem2_url=payload.localizacao_imagem2_url,     # URL da segunda imagem de referência

        # ====== Quantitativo 09 – Painel de Automação ======
        q9_tensao_fonte=payload.q9_tensao_fonte,                     # Tensão da fonte (12V, 24V, ou outro)
        q9_tensao_fonte_outro=payload.q9_tensao_fonte_outro,         # Valor customizado se "outro"
        q9_novo_cabeamento=payload.q9_novo_cabeamento,               # Se será fornecido novo cabeamento
        q9_tipo_cabeamento=payload.q9_tipo_cabeamento,               # Tipo do cabeamento (7 vias, 14 vias, outro)
        q9_tipo_cabeamento_outro=payload.q9_tipo_cabeamento_outro,   # Valor customizado se "outro"
        q9_quantidade_metros=payload.q9_quantidade_metros,           # Quantidade de metros do cabeamento

        # ====== Quantitativo 10 – Portas (Controle de Acesso) ======
        q10_tipo_porta=payload.q10_tipo_porta,                       # Tipo de porta (pivotante ou deslizante)
        q10_servo_motor=payload.q10_servo_motor,                     # Servo motor (apenas para pivotante)
        q10_servo_motor_qtd=payload.q10_servo_motor_qtd,             # Quantidade de servo motores
        q10_ponto_eletrico_novo=payload.q10_ponto_eletrico_novo,    # Precisa de ponto elétrico novo
        q10_suporte_eletroimã=payload.q10_suporte_eletroimã,         # Suporte para eletroímã/fechadura eletrônica
        q10_suporte_eletroimã_qtd=payload.q10_suporte_eletroimã_qtd, # Quantidade de suportes
        q10_botoeira_saida=payload.q10_botoeira_saida,               # Botoeira de saída
        q10_botoeira_saida_qtd=payload.q10_botoeira_saida_qtd,       # Quantidade de botoeiras de saída
        q10_botoeira_emergencia=payload.q10_botoeira_emergencia,     # Botoeira de emergência
        q10_botoeira_emergencia_qtd=payload.q10_botoeira_emergencia_qtd, # Quantidade de botoeiras de emergência
        q10_leitor_cartao=payload.q10_leitor_cartao,                 # Leitor de cartão
        q10_leitor_cartao_qtd=payload.q10_leitor_cartao_qtd,         # Quantidade de leitores de cartão
        q10_leitor_facial=payload.q10_leitor_facial,                 # Leitor facial
        q10_leitor_facial_qtd=payload.q10_leitor_facial_qtd,         # Quantidade de leitores faciais
        q10_sensor_presenca=payload.q10_sensor_presenca,             # Sensor de presença
        q10_sensor_presenca_qtd=payload.q10_sensor_presenca_qtd,     # Quantidade de sensores de presença
        q10_sensor_barreira=payload.q10_sensor_barreira,             # Sensor de barreira/segurança
        q10_sensor_barreira_qtd=payload.q10_sensor_barreira_qtd,     # Quantidade de sensores de barreira
        q9_observacoes=payload.q9_observacoes,                       # Observações sobre painel de automação
        q10_observacoes=payload.q10_observacoes,                     # Observações sobre portas
        q6_modelo=payload.q6_modelo,                                 # Modelo do equipamento de catraca/torniquete/cancela
        q6_quantidade=payload.q6_quantidade,                         # Quantidade de catracas/torniquetes/cancelas
        q6_leitor_facial=payload.q6_leitor_facial,                   # Leitor facial
        q6_leitor_facial_qtd=payload.q6_leitor_facial_qtd,           # Quantidade de leitores faciais
        q6_suporte_leitor_facial=payload.q6_suporte_leitor_facial,   # Suporte para leitor facial
        q6_suporte_leitor_facial_qtd=payload.q6_suporte_leitor_facial_qtd,  # Quantidade de suportes para leitor facial
        q6_leitor_cartao=payload.q6_leitor_cartao,                   # Leitor de cartão
        q6_leitor_cartao_qtd=payload.q6_leitor_cartao_qtd,           # Quantidade de leitores de cartão
        q6_suporte_leitor_cartao=payload.q6_suporte_leitor_cartao,   # Suporte para leitor de cartão
        q6_suporte_leitor_cartao_qtd=payload.q6_suporte_leitor_cartao_qtd,  # Quantidade de suportes para leitor de cartão
        q6_licenca_software=payload.q6_licenca_software,             # Licença do software
        q6_no_break=payload.q6_no_break,                             # No break
        q6_servidor=payload.q6_servidor,                             # Servidor
        q6_observacoes=payload.q6_observacoes,                       # Observações sobre catracas/torniquetes/cancelas

        # ====== Quantitativo 10 – Novos campos (Expansão) ======
        q10_eletroimã_fechadura=payload.q10_eletroimã_fechadura,     # Precisa de eletroímã/fechadura
        q10_eletroimã_fechadura_modelo=payload.q10_eletroimã_fechadura_modelo,  # Modelo do eletroímã/fechadura
        q10_eletroimã_fechadura_qtd=payload.q10_eletroimã_fechadura_qtd,  # Quantidade de eletroímãs/fechaduras
        q10_mola_hidraulica=payload.q10_mola_hidraulica,             # Precisa de mola hidráulica
        q10_mola_hidraulica_tipo=payload.q10_mola_hidraulica_tipo,   # Tipo de mola: piso ou aérea
        q10_mola_hidraulica_qtd=payload.q10_mola_hidraulica_qtd,     # Quantidade de molas hidráulicas
        q10_protecao_botoeira_emergencia_qtd=payload.q10_protecao_botoeira_emergencia_qtd,  # Proteções para botoeira emergência
        q10_botoeira_saida_modelo=payload.q10_botoeira_saida_modelo, # Modelo da botoeira de saída
        q10_botoeira_emergencia_modelo=payload.q10_botoeira_emergencia_modelo,  # Modelo da botoeira de emergência
        q10_leitor_cartao_modelo=payload.q10_leitor_cartao_modelo,   # Modelo do leitor de cartão
        q10_leitor_facial_modelo=payload.q10_leitor_facial_modelo,   # Modelo do leitor facial
        q10_sensor_presenca_modelo=payload.q10_sensor_presenca_modelo,  # Modelo do sensor de presença
        q10_sensor_barreira_modelo=payload.q10_sensor_barreira_modelo,  # Modelo do sensor de barreira/segurança

        # ====== Quantitativo 06 – Expansão de campos ======
        q6_no_break_modelo=payload.q6_no_break_modelo,               # Modelo do no-break
        q6_no_break_qtd=payload.q6_no_break_qtd,                     # Quantidade de no-breaks
        q6_servidor_modelo=payload.q6_servidor_modelo,               # Modelo do servidor
        q6_servidor_qtd=payload.q6_servidor_qtd,                     # Quantidade de servidores

        # ====== Pré-requisitos de instalação ======
        pre_trabalho_altura=payload.pre_trabalho_altura,             # se é trabalho em altura
        pre_plataforma=payload.pre_plataforma,                       # se precisa de plataforma
        pre_plataforma_modelo=payload.pre_plataforma_modelo,         # modelo da plataforma (se aplicável)
        pre_plataforma_dias=payload.pre_plataforma_dias,             # dias de uso da plataforma
        pre_fora_horario_comercial=payload.pre_fora_horario_comercial,  # alinhado ao nome da coluna do modelo
        pre_veiculo_empresa=payload.pre_veiculo_empresa,           # se precisa usar veículo da empresa
        pre_container_materiais=payload.pre_container_materiais,     # se precisa de container para materiais

        # ====== Horas trabalhadas por função (dias normais) ======
        encarregado_dias=payload.encarregado_dias,                   # grava na coluna encarregado_dias o valor enviado no payload
        instalador_dias=payload.instalador_dias,                     # grava na coluna instalador_dias o valor enviado
        auxiliar_dias=payload.auxiliar_dias,                         # grava na coluna auxiliar_dias o valor enviado
        tecnico_de_instalacao_dias=payload.tecnico_de_instalacao_dias,  # grava dias de técnico de instalação
        tecnico_em_seguranca_dias=payload.tecnico_em_seguranca_dias,    # grava dias de técnico em segurança eletrônica

        # ====== Horas extras por função ======
        encarregado_hora_extra=payload.encarregado_hora_extra,       # grava horas extras do encarregado
        instalador_hora_extra=payload.instalador_hora_extra,         # grava horas extras do instalador
        auxiliar_hora_extra=payload.auxiliar_hora_extra,             # grava horas extras do auxiliar
        tecnico_de_instalacao_hora_extra=payload.tecnico_de_instalacao_hora_extra,  # grava horas extras do técnico de instalação
        tecnico_em_seguranca_hora_extra=payload.tecnico_em_seguranca_hora_extra,    # grava horas extras do técnico em segurança

        # ====== Trabalho em domingos/feriados por função ======
        encarregado_trabalho_domingo=payload.encarregado_trabalho_domingo,          # grava horas/dias em domingos do encarregado
        instalador_trabalho_domingo=payload.instalador_trabalho_domingo,            # grava domingos do instalador
        auxiliar_trabalho_domingo=payload.auxiliar_trabalho_domingo,                # grava domingos do auxiliar
        tecnico_de_instalacao_trabalho_domingo=payload.tecnico_de_instalacao_trabalho_domingo,  # grava domingos do técnico de instalação
        tecnico_em_seguranca_trabalho_domingo=payload.tecnico_em_seguranca_trabalho_domingo,    # grava domingos do técnico em segurança

        # ====== Alimentação / Refeições ======
        almoco_qtd=payload.almoco_qtd,                           # grava a quantidade estimada de almoços
        lanche_qtd=payload.lanche_qtd,                           # grava a quantidade estimada de lanches

        # ====== Cronograma e prazos (novos campos) ======
        cronograma_execucao=payload.cronograma_execucao,         # grava se haverá cronograma formal de execução (True/False)
        dias_instalacao=payload.dias_instalacao,                 # grava a quantidade de dias previstos para instalação
        as_built=payload.as_built,                               # grava se haverá entrega de As Built (True/False)
        dias_entrega_relatorio=payload.dias_entrega_relatorio,   # grava o prazo em dias para entrega de relatório
        art=payload.art                                          # grava se haverá ART (True/False)

    )                                                                 # fim da construção do objeto Avaliacao

    db.add(avaliacao)                                            # adiciona o objeto à sessão
    db.commit()                                                  # faz o commit para gravar no banco
    db.refresh(avaliacao)                                        # atualiza o objeto com dados do banco (id, timestamps, etc.)

    # ====== Persistir materiais do painel (Q9) ======
    if payload.materiais_painel:                                # se o payload contém materiais do painel
        for material in payload.materiais_painel:               # itera sobre cada material
            novo_material = AvaliacaoMaterialPainel(            # instancia um novo material do painel
                avaliacao_id=avaliacao.id,                      # associa à avaliação recém-criada
                equipamento=material.equipamento.strip(),       # nome do equipamento
                modelo=material.modelo.strip() if material.modelo else None,  # modelo (opcional)
                quantidade=material.quantidade,                 # quantidade
                fabricante=material.fabricante.strip() if material.fabricante else None  # fabricante (opcional)
            )
            db.add(novo_material)                              # adiciona o material à sessão
        db.commit()                                            # grava os materiais no banco

    log = AvaliacaoAuditoria(                                    # instancia um novo objeto de auditoria
        avaliacao_id=avaliacao.id,                               # associa à avaliação recém-criada
        usuario=usuario.username if usuario else "sistema",     # usuário responsável
        acao="CRIAR",                                            # ação realizada
        detalhes="Avaliação criada via API"                      # detalhe textual simples
    )

    db.add(log)                                                  # adiciona o log à sessão
    db.commit()                                                  # grava o log no banco

    return avaliacao                                             # retorna o objeto Avaliacao (FastAPI converte para schema)
# -----------------------------------------------------------
# Endpoint: listar avaliações (GET /avaliacoes)
# -----------------------------------------------------------
@app.get("/avaliacoes",                                          # define rota GET /avaliacoes
         response_model=List[AvaliacaoOutSchema])                # resposta será uma lista de AvaliacaoOutSchema
def listar_avaliacoes(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    usuario=Depends(get_current_user)
):
    from sqlalchemy.orm import joinedload                        # importa joinedload para eager loading

    query = db.query(Avaliacao).options(                         # monta a query com eager loading
        joinedload(Avaliacao.materiais_painel)                   # carrega relacionamento materiais_painel
    )
    if usuario.role == 'avaliador':
        query = query.filter(Avaliacao.usuario_id == usuario.id)
    avaliacoes = query.offset(skip).limit(limit).all()
    # Adiciona o nome do criador em cada avaliação
    for av in avaliacoes:
        if hasattr(av, 'usuario') and av.usuario:
            av.criado_por_nome = av.usuario.nome
        else:
            av.criado_por_nome = None
    return avaliacoes

# -----------------------------------------------------------
# Endpoint: criar avaliação

# @app.post("/avaliacoes", response_model=AvaliacaoOutSchema)
# def criar_avaliacao(payload: AvaliacaoBaseSchema, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
#     # Visualizador não pode criar avaliações
#     if usuario and getattr(usuario, 'role', None) == 'visualizador':
#         raise HTTPException(status_code=403, detail="Usuário Visualizador não tem permissão para criar avaliações.")

#     nova_avaliacao = Avaliacao(**payload.dict(exclude_unset=True))
#     nova_avaliacao.usuario_id = usuario.id
#     db.add(nova_avaliacao)
#     db.commit()
#     db.refresh(nova_avaliacao)
#     return nova_avaliacao

# Endpoint: adicionar equipamento a uma avaliação
# -----------------------------------------------------------
@app.post("/avaliacoes/{avaliacao_id}/equipamentos",             # rota POST com id da avaliação na URL
          response_model=EquipamentoOutSchema)                   # resposta será o equipamento criado
def adicionar_equipamento(                                       # função para criar equipamento
    avaliacao_id: int,                                           # id da avaliação vindo da URL
    payload: EquipamentoBaseSchema,                              # dados do equipamento enviados no corpo
    db: Session = Depends(get_db),                               # sessão de banco injetada
    usuario_atual: Usuario = Depends(obter_usuario_atual)        # usuário autenticado
):
    avaliacao = db.query(Avaliacao).filter(                      # busca a avaliação no banco
        Avaliacao.id == avaliacao_id                             # condição: id igual ao fornecido
    ).first()                                                    # pega o primeiro resultado

    if not avaliacao:                                            # se não encontrou avaliação
        raise HTTPException(                                     # lança erro HTTP
            status_code=404,                                     # código 404 (não encontrado)
            detail="Avaliação não encontrada"                    # mensagem de erro
        )

    # Bloqueia usuários Visualizador de modificar avaliações
    if usuario_atual and getattr(usuario_atual, 'role', None) == 'visualizador':
        raise HTTPException(status_code=403, detail="Usuário Visualizador não tem permissão para adicionar equipamentos.")

    equipamento = AvaliacaoEquipamento(                          # cria instância ORM de equipamento
        avaliacao_id=avaliacao_id,                               # associa ao id da avaliação
        equipamento=payload.equipamento,                         # nome do equipamento
        modelo=payload.modelo,                                   # modelo do equipamento
        quantidade=payload.quantidade,                           # quantidade
        fabricante=payload.fabricante                            # fabricante
    )

    db.add(equipamento)                                          # adiciona o equipamento à sessão
    db.commit()                                                  # grava no banco
    db.refresh(equipamento)                                      # recarrega o objeto com dados do banco (id, etc.)

    detalhes_log = json.dumps(                                   # monta JSON com detalhes para auditoria
        {
            "acao": "adicionar_equipamento",                     # tipo de ação
            "equipamento": payload.equipamento,                  # nome do equipamento
            "modelo": payload.modelo,                            # modelo
            "quantidade": payload.quantidade,                    # quantidade
            "fabricante": payload.fabricante                     # fabricante
        },
        ensure_ascii=False                                       # mantém acentuação corretamente
    )

    log = AvaliacaoAuditoria(                                    # cria registro de auditoria
        avaliacao_id=avaliacao.id,                               # associa à avaliação
        usuario="sistema",                                       # usuário responsável (ajustar depois se tiver login)
        acao="ADD_EQUIPAMENTO",                                  # código da ação
        detalhes=detalhes_log                                    # detalhes em JSON
    )

    db.add(log)                                                  # adiciona log à sessão
    db.commit()                                                  # grava log no banco

    return equipamento                                            # retorna equipamento criado

# -----------------------------------------------------------
# Endpoint: listar equipamentos de uma avaliação
# -----------------------------------------------------------
@app.get("/avaliacoes/{avaliacao_id}/equipamentos",              # rota GET para listar equipamentos
         response_model=List[EquipamentoOutSchema])              # resposta: lista de equipamentos
def listar_equipamentos(                                         # função para listar equipamentos
    avaliacao_id: int,                                           # id da avaliação vindo da URL
    db: Session = Depends(get_db)                                # sessão de banco injetada
):
    equipamentos = db.query(AvaliacaoEquipamento).filter(        # monta a query na tabela de equipamentos
        AvaliacaoEquipamento.avaliacao_id == avaliacao_id        # filtra pelo id da avaliação
    ).all()                                                      # obtém todos os resultados

    return equipamentos                                          # retorna lista de equipamentos (pode ser vazia)

@app.post(
    "/avaliacoes/{avaliacao_id}/imagens/upload",                           # endpoint para upload genérico de imagens (novo modelo escalável)
    response_model=UploadImagemResponseSchema,                              # reutiliza schema {avaliacao_id, campo, url} para retornar a URL pública
    summary="Fazer upload de uma imagem genérica da avaliação (novo)",       # descrição curta no Swagger
)
async def upload_imagem_avaliacao_generica(
    avaliacao_id: int,                                                      # id da avaliação que receberá a imagem
    contexto: str = Form(..., description="contexto da imagem (ex.: q2_switch)"),  # contexto/agrupador da imagem (usado no nome do arquivo)
    arquivo: UploadFile = File(...),                                        # arquivo de imagem enviado via multipart/form-data
    db: Session = Depends(get_db),                                          # injeta a sessão de banco
    usuario_atual: Usuario = Depends(obter_usuario_atual),                  # garante autenticação
) -> UploadImagemResponseSchema:                                            # schema de retorno
    avaliacao = db.query(Avaliacao).filter(Avaliacao.id == avaliacao_id).first()  # busca a avaliação no banco
    if not avaliacao:                                                       # se a avaliação não existir
        raise HTTPException(status_code=404, detail="Avaliação não encontrada.")  # retorna 404

    # Bloqueia usuários Visualizador de modificar avaliações (upload de imagens)
    if usuario_atual and getattr(usuario_atual, 'role', None) == 'visualizador':
        raise HTTPException(status_code=403, detail="Usuário Visualizador não tem permissão para enviar imagens ou alterar a avaliação.")

    contexto_limpo = (contexto or "").strip()                               # remove espaços e garante string
    contexto_limpo = re.sub(r"[^a-zA-Z0-9_-]+", "_", contexto_limpo)         # troca caracteres estranhos por "_" (evita path injection)
    contexto_limpo = (contexto_limpo[:50] or "geral")                       # limita tamanho e define fallback

    extensao_original = os.path.splitext(arquivo.filename or "")[1].lower()  # extrai extensão do arquivo
    if extensao_original not in [".jpg", ".jpeg", ".png", ".webp"]:          # valida formatos aceitos (mesmo padrão do legado)
        raise HTTPException(status_code=400, detail="Formato de imagem não suportado. Use JPG, JPEG, PNG ou WEBP.")  # erro amigável

    nome_arquivo = f"avt_{avaliacao_id}_{contexto_limpo}_{uuid.uuid4().hex}{extensao_original}"  # nome único
    caminho_arquivo = os.path.join(UPLOAD_DIR, nome_arquivo)                # caminho físico na pasta de uploads

    with open(caminho_arquivo, "wb") as buffer:                             # abre arquivo no disco para escrita binária
        shutil.copyfileobj(arquivo.file, buffer)                            # copia o conteúdo do upload para o arquivo

    url_publica = f"/uploads/{nome_arquivo}"                                # URL pública servida via StaticFiles em /uploads
    return UploadImagemResponseSchema(                                      # retorna schema compatível
        avaliacao_id=avaliacao_id,                                          # devolve o id da avaliação
        campo=contexto_limpo,                                               # reaproveita "campo" para indicar o contexto
        url=url_publica,                                                   # devolve a URL para o frontend salvar no banco
    )

@app.post(
    "/avaliacoes/{avaliacao_id}/imagens",  # endpoint para fazer upload de imagem de localização de uma avaliação existente
    response_model=UploadImagemResponseSchema,  # define o formato da resposta usando o schema criado
    summary="Fazer upload de uma imagem de localização da avaliação",  # texto curto que aparece na documentação (Swagger)
)
async def upload_imagem_avaliacao(
    avaliacao_id: int,  # id da avaliação que será atualizada
    campo: str = Form(..., description="localizacao_imagem1_url ou localizacao_imagem2_url"),  # indica qual campo de imagem deve ser preenchido
    arquivo: UploadFile = File(...),  # arquivo de imagem enviado via multipart/form-data
    db: Session = Depends(get_db),  # injeta a sessão de banco usando a dependência padrão
    usuario_atual: Usuario = Depends(obter_usuario_atual),  # garante que apenas usuários autenticados usem a rota
) -> UploadImagemResponseSchema:  # define o tipo de retorno esperado pela função
    if campo not in ("localizacao_imagem1_url", "localizacao_imagem2_url"):  # valida se o campo enviado é um dos dois aceitos
        raise HTTPException(  # dispara erro HTTP se o campo for inválido
            status_code=400,  # HTTP 400 - requisição inválida
            detail="Campo de imagem inválido. Use localizacao_imagem1_url ou localizacao_imagem2_url.",  # mensagem com instrução correta
        )

    avaliacao = db.query(Avaliacao).filter(Avaliacao.id == avaliacao_id).first()  # busca a avaliação correspondente no banco pelo id informado
    if not avaliacao:  # se nenhuma avaliação for encontrada
        raise HTTPException(  # dispara erro HTTP 404
            status_code=404,  # HTTP 404 - não encontrado
            detail="Avaliação não encontrada.",  # mensagem informando que o id não existe
        )

    # Bloqueia usuários Visualizador de modificar avaliações (upload de imagens)
    if usuario_atual and getattr(usuario_atual, 'role', None) == 'visualizador':
        raise HTTPException(status_code=403, detail="Usuário Visualizador não tem permissão para enviar imagens ou alterar a avaliação.")

    extensao_original = os.path.splitext(arquivo.filename or "")[1].lower()  # extrai a extensão do arquivo enviado (ex.: .jpg, .png)
    if extensao_original not in [".jpg", ".jpeg", ".png", ".webp"]:  # restringe os formatos de imagem aceitos
        raise HTTPException(  # dispara erro se o formato não estiver na lista permitida
            status_code=400,  # HTTP 400 - requisição inválida
            detail="Formato de imagem não suportado. Use JPG, JPEG, PNG ou WEBP.",  # mensagem de erro amigável para o usuário
        )

    timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")  # gera um timestamp em UTC para evitar nomes duplicados
    nome_arquivo = f"avt_{avaliacao_id}_{campo}_{timestamp}{extensao_original}"  # monta um nome de arquivo único com id da avaliação, campo e timestamp
    caminho_arquivo = os.path.join(UPLOAD_DIR, nome_arquivo)  # monta o caminho físico completo do arquivo dentro da pasta de uploads

    with open(caminho_arquivo, "wb") as destino:  # abre o arquivo de destino em modo binário de escrita
        shutil.copyfileobj(arquivo.file, destino)  # copia todo o conteúdo do arquivo enviado para o arquivo no disco

    url_publica = f"/uploads/{nome_arquivo}"  # monta a URL relativa que será usada pelo front para exibir a imagem

    setattr(avaliacao, campo, url_publica)  # grava no objeto Avaliacao o valor da URL no campo correspondente (1 ou 2)
    db.add(avaliacao)  # adiciona a avaliação (modificada) à sessão do banco
    db.commit()  # confirma a transação e persiste a mudança no banco
    db.refresh(avaliacao)  # recarrega o objeto Avaliacao com os dados atualizados vindos do banco

    return UploadImagemResponseSchema(  # monta e retorna o objeto de resposta da API
        avaliacao_id=avaliacao.id,  # id da avaliação que foi atualizada
        campo=campo,  # nome do campo de imagem alterado
        url=url_publica,  # URL relativa onde a imagem está disponível
    )

# -----------------------------------------------------------
# Endpoint: remover um equipamento específico
# -----------------------------------------------------------
@app.delete("/equipamentos/{equipamento_id}")                    # rota DELETE com id do equipamento
def remover_equipamento(                                         # função para remover equipamento
    equipamento_id: int,                                         # id do equipamento vindo da URL
    db: Session = Depends(get_db),                               # sessão de banco injetada
    usuario_atual: Usuario = Depends(obter_usuario_atual)        # usuário autenticado
):
    equipamento = db.query(AvaliacaoEquipamento).filter(         # busca o equipamento
        AvaliacaoEquipamento.id == equipamento_id                # filtra pelo id informado
    ).first()                                                    # pega o primeiro resultado

    if not equipamento:                                          # se não encontrou
        raise HTTPException(                                     # lança erro HTTP
            status_code=404,                                     # código 404
            detail="Equipamento não encontrado"                  # mensagem
        )

    # Bloqueia Visualizador de excluir itens
    if usuario_atual and getattr(usuario_atual, 'role', None) == 'visualizador':
        raise HTTPException(status_code=403, detail="Usuário Visualizador não tem permissão para remover equipamentos.")

    avaliacao_id = equipamento.avaliacao_id                      # guarda id da avaliação para o log

    detalhes_log = json.dumps(                                   # monta JSON com informações removidas
        {
            "acao": "remover_equipamento",                       # tipo de ação
            "equipamento": equipamento.equipamento,              # nome do equipamento
            "modelo": equipamento.modelo,                        # modelo
            "quantidade": equipamento.quantidade,                # quantidade
            "fabricante": equipamento.fabricante                 # fabricante
        },
        ensure_ascii=False                                       # mantém acentos
    )

    db.delete(equipamento)                                       # marca o equipamento para remoção
    db.commit()                                                  # aplica a remoção no banco

    log = AvaliacaoAuditoria(                                    # cria registro de auditoria
        avaliacao_id=avaliacao_id,                               # id da avaliação associada
        usuario="sistema",                                       # usuário responsável
        acao="REMOVER_EQUIPAMENTO",                              # código da ação
        detalhes=detalhes_log                                    # detalhes em JSON
    )

    db.add(log)                                                  # adiciona log à sessão
    db.commit()                                                  # grava log no banco

    return {"detail": "Equipamento removido com sucesso"}        # resposta simples de confirmação

# -----------------------------------------------------------
# Endpoint: listar imagens de uma avaliação
# -----------------------------------------------------------
@app.get(                                                        # decorador que define um endpoint HTTP GET
    "/avaliacoes/{avaliacao_id}/imagens",                        # rota para listar imagens vinculadas a uma avaliação específica
    response_model=List[ImagemOutSchema],                        # resposta será uma lista de imagens no formato do schema de saída
)
def listar_imagens_avaliacao(                                    # função que implementa a lógica de listagem de imagens
    avaliacao_id: int,                                           # id da avaliação recebido como parte da URL
    contexto: Optional[str] = None,                              # contexto opcional para filtrar as imagens (ex.: 'switch', 'localizacao')
    db: Session = Depends(get_db),                               # injeta a sessão de banco de dados na função
):                                                               # fim da assinatura da função
    query = db.query(AvaliacaoImagem).filter(                    # inicia a query na tabela de imagens
        AvaliacaoImagem.avaliacao_id == avaliacao_id             # filtra apenas registros vinculados à avaliação informada
    )                                                            # fim da construção inicial da query

    if contexto:                                                 # se um contexto específico tiver sido informado
        query = query.filter(                                    # refina a query existente
            AvaliacaoImagem.contexto == contexto                 # mantendo apenas imagens do contexto desejado
        )                                                        # fim do filtro por contexto

    imagens = query.order_by(                                    # define a ordenação do resultado
        AvaliacaoImagem.ordem.asc()                              # ordena pela coluna "ordem" em ordem crescente
    ).all()                                                      # executa a query e retorna todas as imagens encontradas

    return imagens                                               # retorna a lista de imagens (pode ser vazia se não houver registros)

# -----------------------------------------------------------
# Endpoint: deletar imagens de uma avaliação por contexto
# -----------------------------------------------------------
@app.delete(                                                     # decorador que define um endpoint HTTP DELETE
    "/avaliacoes/{avaliacao_id}/imagens/contexto/{contexto}",    # rota para deletar imagens de um contexto específico
)
def deletar_imagens_por_contexto(                                # função que implementa a deleção por contexto
    avaliacao_id: int,                                           # id da avaliação recebido pela URL
    contexto: str,                                               # contexto a ser deletado (ex.: q2_switch, localizacao)
    db: Session = Depends(get_db),                               # sessão de banco de dados injetada pelo FastAPI
    usuario_atual: Usuario = Depends(obter_usuario_atual)        # usuário autenticado
):                                                               # fim da assinatura da função
    avaliacao = db.query(Avaliacao).filter(                      # busca a avaliação correspondente no banco
        Avaliacao.id == avaliacao_id                             # filtra pelo id informado na URL
    ).first()                                                    # retorna o primeiro resultado (ou None, se não existir)

    if not avaliacao:                                            # se nenhuma avaliação for encontrada
        raise HTTPException(                                     # lança uma exceção HTTP
            status_code=404,                                     # código 404 - recurso não encontrado
            detail="Avaliação não encontrada",                   # mensagem de erro retornada para o cliente
        )                                                        # fim do raise HTTPException

    # Bloqueia usuários Visualizador de modificar avaliações (deletar imagens)
    if usuario_atual and getattr(usuario_atual, 'role', None) == 'visualizador':
        raise HTTPException(status_code=403, detail="Usuário Visualizador não tem permissão para deletar imagens.")

    deleted_count = db.query(AvaliacaoImagem).filter(            # monta query para remover imagens do contexto
        AvaliacaoImagem.avaliacao_id == avaliacao_id,            # restringe à avaliação atual
        AvaliacaoImagem.contexto == contexto                     # restringe ao contexto específico
    ).delete(synchronize_session=False)                          # executa remoção em lote

    db.commit()                                                  # confirma a remoção no banco

    return {"deleted": deleted_count, "contexto": contexto}      # retorna quantidade deletada e contexto

# -----------------------------------------------------------
# Endpoint: salvar (sincronizar) imagens de uma avaliação
# -----------------------------------------------------------
@app.put(                                                        # decorador que define um endpoint HTTP PUT
    "/avaliacoes/{avaliacao_id}/imagens",                        # rota para sobrescrever as imagens de uma avaliação
    response_model=List[ImagemOutSchema],                        # resposta será a lista de imagens persistidas após a operação
)
def salvar_imagens_avaliacao(                                    # função que implementa a sincronização das imagens
    avaliacao_id: int,                                           # id da avaliação recebido pela URL
    imagens: List[ImagemBaseSchema],                             # lista de imagens enviada no corpo da requisição
    db: Session = Depends(get_db),                               # sessão de banco de dados injetada pelo FastAPI
    usuario_atual: Usuario = Depends(obter_usuario_atual)        # usuário autenticado
):                                                               # fim da assinatura da função
    avaliacao = db.query(Avaliacao).filter(                      # busca a avaliação correspondente no banco
        Avaliacao.id == avaliacao_id                             # filtra pelo id informado na URL
    ).first()                                                    # retorna o primeiro resultado (ou None, se não existir)

    if not avaliacao:                                            # se nenhuma avaliação for encontrada
        raise HTTPException(                                     # lança uma exceção HTTP
            status_code=404,                                     # código 404 - recurso não encontrado
            detail="Avaliação não encontrada",                   # mensagem de erro retornada para o cliente
        )                                                        # fim do raise HTTPException

    # Bloqueia usuários Visualizador de modificar avaliações (sincronizar imagens)
    if usuario_atual and getattr(usuario_atual, 'role', None) == 'visualizador':
        raise HTTPException(status_code=403, detail="Usuário Visualizador não tem permissão para alterar imagens ou modificar a avaliação.")

    if not imagens:                                              # se a lista recebida estiver vazia
        db.query(AvaliacaoImagem).filter(                        # monta query para remover todas as imagens da avaliação
            AvaliacaoImagem.avaliacao_id == avaliacao_id         # filtrando pelo id da avaliação
        ).delete(synchronize_session=False)                      # executa remoção em lote sem sincronizar a sessão ORM
        db.commit()                                              # confirma a remoção no banco
        return []                                                # retorna lista vazia indicando que não há mais imagens cadastradas

    contextos = {img.contexto for img in imagens}                # cria um conjunto com todos os contextos distintos presentes na lista

    for ctx in contextos:                                        # percorre cada contexto identificado
        db.query(AvaliacaoImagem).filter(                        # monta query para remover imagens existentes nesse contexto
            AvaliacaoImagem.avaliacao_id == avaliacao_id,        # restringe à avaliação atual
            AvaliacaoImagem.contexto == ctx                      # restringe ao contexto específico
        ).delete(synchronize_session=False)                      # executa remoção em lote para aquele contexto

    db.commit()                                                  # confirma todas as remoções feitas para os contextos envolvidos

    imagens_salvas: List[AvaliacaoImagem] = []                   # lista que armazenará as instâncias ORM das novas imagens criadas

    for img in imagens:                                          # percorre cada imagem enviada pelo cliente
        nova_imagem = AvaliacaoImagem(                           # cria uma nova instância da entidade de imagem
            avaliacao_id=avaliacao_id,                           # associa a imagem à avaliação informada na URL
            contexto=img.contexto,                               # define o contexto da imagem (ex.: 'switch', 'localizacao')
            ordem=img.ordem,                                     # define a ordem de exibição da imagem dentro do contexto
            url=img.url,                                         # define a URL/caminho público da imagem
            descricao=img.descricao,                             # define a descrição (pode ser None)
        )                                                        # fim da construção da instância AvaliacaoImagem

        db.add(nova_imagem)                                      # adiciona a nova imagem à sessão do banco
        imagens_salvas.append(nova_imagem)                       # guarda referência da nova imagem para retorno posterior

    db.commit()                                                  # grava todas as novas imagens no banco de dados

    for nova_imagem in imagens_salvas:                           # percorre novamente as imagens recém inseridas
        db.refresh(nova_imagem)                                  # recarrega cada objeto para garantir campos atualizados (ex.: id)

    detalhes_log = json.dumps(                                   # monta um JSON com detalhes da operação para auditoria
        {
            "acao": "sincronizar_imagens",                       # nome da ação executada
            "avaliacao_id": avaliacao_id,                        # id da avaliação afetada
            "total_imagens": len(imagens_salvas),                # quantidade total de imagens persistidas
            "contextos": sorted(list(contextos)),                # lista ordenada dos contextos envolvidos na operação
        },
        ensure_ascii=False                                       # mantém acentuação UTF-8 no JSON
    )                                                            # fim da construção do JSON de detalhes

    log = AvaliacaoAuditoria(                                    # cria um novo registro de auditoria
        avaliacao_id=avaliacao_id,                               # associa o log à avaliação correspondente
        usuario="sistema",                                       # usuário responsável (pode ser ajustado para o usuário logado depois)
        acao="SINCRONIZAR_IMAGENS",                              # código da ação, usado para identificar o tipo de evento
        detalhes=detalhes_log                                    # JSON com os detalhes da sincronização
    )                                                            # fim da criação do objeto de auditoria

    db.add(log)                                                  # adiciona o log à sessão do banco
    db.commit()                                                  # grava o registro de auditoria no banco de dados

    return imagens_salvas                                        # retorna para o cliente a lista de imagens salvas no banco

# -----------------------------------------------------------
# Endpoint: adicionar outro recurso a uma avaliação
# -----------------------------------------------------------
@app.post("/avaliacoes/{avaliacao_id}/outros_recursos",          # rota POST para criar recurso
          response_model=OutroRecursoOutSchema)                  # resposta: recurso criado
def adicionar_outro_recurso(                                     # função para criar recurso
    avaliacao_id: int,                                           # id da avaliação vindo da URL
    payload: OutroRecursoBaseSchema,                             # dados do recurso enviados no corpo
    db: Session = Depends(get_db),                               # sessão de banco injetada
    usuario_atual: Usuario = Depends(obter_usuario_atual)        # usuário autenticado
):
    avaliacao = db.query(Avaliacao).filter(                      # busca a avaliação
        Avaliacao.id == avaliacao_id                             # filtra pelo id
    ).first()                                                    # pega o primeiro resultado

    if not avaliacao:                                            # se não encontrou avaliação
        raise HTTPException(                                     # lança erro
            status_code=404,                                     # código 404
            detail="Avaliação não encontrada"                    # mensagem
        )

    # Bloqueia usuários Visualizador de modificar avaliações
    if usuario_atual and getattr(usuario_atual, 'role', None) == 'visualizador':
        raise HTTPException(status_code=403, detail="Usuário Visualizador não tem permissão para adicionar recursos.")

    recurso = AvaliacaoOutroRecurso(                             # cria instância ORM do recurso
        avaliacao_id=avaliacao_id,                               # associa à avaliação
        descricao=payload.descricao,                             # descrição do recurso
        quantidade=payload.quantidade                            # quantidade
    )

    db.add(recurso)                                              # adiciona à sessão
    db.commit()                                                  # grava no banco
    db.refresh(recurso)                                          # recarrega objeto com id, etc.

    detalhes_log = json.dumps(                                   # monta JSON para auditoria
        {
            "acao": "adicionar_outro_recurso",                   # tipo de ação
            "descricao": payload.descricao,                      # descrição
            "quantidade": payload.quantidade                     # quantidade
        },
        ensure_ascii=False                                       # mantém acentos
    )

    log = AvaliacaoAuditoria(                                    # cria registro de auditoria
        avaliacao_id=avaliacao.id,                               # id da avaliação associada
        usuario="sistema",                                       # usuário responsável
        acao="ADD_OUTRO_RECURSO",                                # código da ação
        detalhes=detalhes_log                                    # detalhes em JSON
    )

    db.add(log)                                                  # adiciona log
    db.commit()                                                  # grava log

    return recurso                                               # retorna recurso criado

# -----------------------------------------------------------
# Endpoint: listar outros recursos de uma avaliação
# -----------------------------------------------------------
@app.get("/avaliacoes/{avaliacao_id}/outros_recursos",           # rota GET para listar recursos
         response_model=List[OutroRecursoOutSchema])             # resposta: lista de recursos
def listar_outros_recursos(                                      # função para listar recursos
    avaliacao_id: int,                                           # id da avaliação vindo da URL
    db: Session = Depends(get_db)                                # sessão de banco injetada
):
    recursos = db.query(AvaliacaoOutroRecurso).filter(           # monta query na tabela de recursos
        AvaliacaoOutroRecurso.avaliacao_id == avaliacao_id       # filtra pelo id da avaliação
    ).all()                                                      # obtém todos os registros

    return recursos                                              # retorna a lista (pode ser vazia)
# -----------------------------------------------------------
# Endpoint: remover um outro recurso específico
# -----------------------------------------------------------
@app.delete("/outros_recursos/{recurso_id}")                     # rota DELETE com id do recurso
def remover_outro_recurso(                                       # função para remover recurso
    recurso_id: int,                                             # id do recurso vindo da URL
    db: Session = Depends(get_db),                               # sessão de banco injetada
    usuario_atual: Usuario = Depends(obter_usuario_atual)        # usuário autenticado
):
    recurso = db.query(AvaliacaoOutroRecurso).filter(            # busca o recurso no banco
        AvaliacaoOutroRecurso.id == recurso_id                   # filtra pelo id informado
    ).first()                                                    # pega o primeiro resultado

    if not recurso:                                              # se não encontrou
        raise HTTPException(                                     # lança erro HTTP
            status_code=404,                                     # código 404
            detail="Recurso não encontrado"                      # mensagem
        )

    if usuario_atual.role == 'visualizador':
        raise HTTPException(status_code=403, detail="Usuário não tem permissão para remover recursos")

    avaliacao_id = recurso.avaliacao_id                          # guarda id da avaliação para o log

    detalhes_log = json.dumps(                                   # monta JSON com dados removidos
        {
            "acao": "remover_outro_recurso",                     # tipo de ação
            "descricao": recurso.descricao,                      # descrição
            "quantidade": recurso.quantidade                     # quantidade
        },
        ensure_ascii=False                                       # mantém acentos
    )

    db.delete(recurso)                                           # marca o recurso para remoção
    db.commit()                                                  # aplica a remoção

    log = AvaliacaoAuditoria(                                    # cria registro de auditoria
        avaliacao_id=avaliacao_id,                               # id da avaliação associada
        usuario="sistema",                                       # usuário responsável
        acao="REMOVER_OUTRO_RECURSO",                            # código da ação
        detalhes=detalhes_log                                    # detalhes em JSON
    )

    db.add(log)                                                  # adiciona log
    db.commit()                                                  # grava log

    return {"detail": "Recurso removido com sucesso"}            # resposta simples confirmando

# -----------------------------------------------------------
# Endpoint: obter uma avaliação específica (GET /avaliacoes/{id})
# -----------------------------------------------------------
@app.get("/avaliacoes/{avaliacao_id}",                           # define rota GET com parâmetro de caminho avaliacao_id
         response_model=AvaliacaoOutSchema)                      # resposta será uma avaliação única
def obter_avaliacao(                                             # função para obter uma avaliação específica
    avaliacao_id: int,                                           # parâmetro de rota representando o ID da avaliação
    db: Session = Depends(get_db)                                # sessão de banco injetada pela dependência
):
    from sqlalchemy.orm import joinedload                        # importa joinedload para eager loading

    avaliacao = db.query(Avaliacao).options(                     # monta a query com eager loading
        joinedload(Avaliacao.materiais_painel)                   # carrega relacionamento materiais_painel
    ).filter(                                                    # aplica filtro
        Avaliacao.id == avaliacao_id                             # condição: id igual ao id recebido
    ).first()                                                    # busca o primeiro (e único) resultado

    if not avaliacao:                                            # se não encontrou avaliação
        raise HTTPException(                                     # lança exceção HTTP
            status_code=404,                                     # código 404 (não encontrado)
            detail="Avaliação não encontrada"                    # mensagem de erro
        )

    return avaliacao                                             # retorna o objeto Avaliacao (convertido para schema)

# -----------------------------------------------------------
# Endpoint: atualizar uma avaliação (PUT /avaliacoes/{id})
# -----------------------------------------------------------
@app.put("/avaliacoes/{avaliacao_id}",                           # define rota PUT com parâmetro de caminho avaliacao_id
         response_model=AvaliacaoOutSchema)                      # resposta será a avaliação atualizada
def atualizar_avaliacao(                                         # função para atualizar uma avaliação existente
    avaliacao_id: int,                                           # id da avaliação vindo da URL
    payload: AvaliacaoUpdateSchema,                              # dados enviados pelo cliente (campos opcionais)
    db: Session = Depends(get_db),                               # sessão de banco injetada
    usuario: Usuario = Depends(obter_usuario_atual)              # usuário autenticado
):
    from datetime import datetime                                # importa datetime para tratar datas

    avaliacao = db.query(Avaliacao).filter(                      # busca a avaliação no banco
        Avaliacao.id == avaliacao_id                             # condição: id igual ao id recebido
    ).first()                                                    # pega o primeiro resultado

    if not avaliacao:                                            # se não encontrou avaliação com esse id
        raise HTTPException(                                     # lança um erro HTTP
            status_code=404,                                     # código 404 (não encontrado)
            detail="Avaliação não encontrada"                    # mensagem de erro
        )

    # Visualizador não pode editar avaliações
    if usuario and getattr(usuario, 'role', None) == 'visualizador':
        raise HTTPException(status_code=403, detail="Usuário Visualizador não tem permissão para editar avaliações.")

    alteracoes = []                                              # lista para registrar alterações realizadas, usada no audit trail

    # Atualiza cliente_nome se enviado e se mudou
    if payload.cliente_nome is not None:                         # verifica se o campo cliente_nome foi enviado
        if payload.cliente_nome != avaliacao.cliente_nome:       # compara valor novo com o atual
            alteracoes.append({                                  # registra a alteração em uma lista
                "campo": "cliente_nome",                         # nome do campo
                "antes": avaliacao.cliente_nome,                 # valor anterior
                "depois": payload.cliente_nome                   # valor novo
            })
            avaliacao.cliente_nome = payload.cliente_nome        # aplica a alteração no objeto ORM

    # Atualiza data_avaliacao se enviada e se mudou
    if payload.data_avaliacao is not None:                       # verifica se a data foi enviada
        try:
            nova_data = datetime.strptime(                       # converte a string recebida em objeto date
                payload.data_avaliacao,                          # string de entrada
                "%Y-%m-%d"                                       # formato esperado
            ).date()                                             # pega somente a parte de data
        except ValueError:                                       # se a conversão falhar
            raise HTTPException(                                 # lança erro de requisição inválida
                status_code=400,                                 # código 400
                detail="data_avaliacao deve estar no formato YYYY-MM-DD"  # mensagem de erro
            )
        if nova_data != avaliacao.data_avaliacao:                # compara nova data com a atual
            alteracoes.append({                                  # registra alteração
                "campo": "data_avaliacao",                       # nome do campo
                "antes": str(avaliacao.data_avaliacao),          # valor anterior como string
                "depois": payload.data_avaliacao                 # valor novo como string
            })
            avaliacao.data_avaliacao = nova_data                 # aplica a nova data

    # Helper interno para evitar repetição de código nos campos simples
    def atualiza_campo(nome_attr: str, nome_label: str):         # função interna para atualizar um campo texto simples
        valor_novo = getattr(payload, nome_attr)                 # obtém o valor do campo no payload
        if valor_novo is not None:                               # se o campo foi enviado
            valor_atual = getattr(avaliacao, nome_attr)          # obtém o valor atual na avaliação
            if valor_novo != valor_atual:                        # compara novo e atual
                alteracoes.append({                              # registra a alteração
                    "campo": nome_label,                         # nome "humano" do campo
                    "antes": valor_atual,                        # valor anterior
                    "depois": valor_novo                         # novo valor
                })
                setattr(avaliacao, nome_attr, valor_novo)        # atualiza o atributo no objeto Avaliacao

    # Atualiza campos de texto/curtos usando o helper
    atualiza_campo("local", "local")                             # atualiza campo local, se necessário
    atualiza_campo("objeto", "objeto")                           # atualiza campo objeto, se necessário
    atualiza_campo("status", "status")                           # atualiza campo status, se necessário
    #tipo_formulario
    atualiza_campo("tipo_formulario", "tipo_formulario")         # atualiza tipo de formulário, se enviado
    #tipo_formulario
    atualiza_campo("equipe", "equipe")                           # atualiza campo equipe, se necessário
    atualiza_campo("responsavel_avaliacao", "responsavel_avaliacao")  # atualiza responsável pela avaliação
    atualiza_campo("contato", "contato")                         # atualiza contato do cliente
    atualiza_campo("email_cliente", "email_cliente")             # atualiza e-mail do cliente
    atualiza_campo("escopo_texto", "escopo_texto")               # atualiza escopo da avaliação
    # Atualiza campos comerciais
    atualiza_campo("pedido_compra", "pedido_compra")             # atualiza pedido de compra
    atualiza_campo("numero_proposta", "numero_proposta")         # atualiza número da proposta

    # ===== Novos campos: características gerais =====
    atualiza_campo("servico_fora_montes_claros", "servico_fora_montes_claros")  # indica se o serviço é fora de Montes Claros
    atualiza_campo("servico_intermediario", "servico_intermediario")            # indica se é serviço para intermediário/empreiteira

    # Quantitativo 01 – Patch Panel / Cabeamento UTP
    atualiza_campo("q1_categoria_cab", "q1_categoria_cab")                    # categoria do cabeamento (Cat5e/Cat6/Cat6a)
    atualiza_campo("q1_blindado", "q1_blindado")                              # se o cabeamento é blindado
    atualiza_campo("q1_novo_patch_panel", "q1_novo_patch_panel")              # se será fornecido novo patch panel
    atualiza_campo("q1_incluir_guia", "q1_incluir_guia")                      # se inclui guia de cabos
    atualiza_campo("q1_qtd_pontos_rede", "q1_qtd_pontos_rede")                # quantidade de pontos de rede
    atualiza_campo("q1_qtd_cabos", "q1_qtd_cabos")                            # quantidade de cabos UTP
    atualiza_campo("q1_qtd_portas_patch_panel", "q1_qtd_portas_patch_panel")  # quantidade de portas do patch panel
    atualiza_campo("q1_qtd_patch_cords", "q1_qtd_patch_cords")                # quantidade de patch cords
    atualiza_campo("q1_marca_cab", "q1_marca_cab")                            # marca do cabeamento UTP
    atualiza_campo("q1_modelo_patch_panel", "q1_modelo_patch_panel")          # modelo/descrição do patch panel
    atualiza_campo("q1_qtd_guias_cabos", "q1_qtd_guias_cabos")                # quantidade de guias de cabos
    atualiza_campo("q1_patch_cords_modelo", "q1_patch_cords_modelo")          # modelo/descrição dos patch cords
    atualiza_campo("q1_patch_cords_cor", "q1_patch_cords_cor")                # cor ou cores dos patch cords
    atualiza_campo("q1_patch_panel_existente_nome", "q1_patch_panel_existente_nome")  # identificação do patch panel existente

    # Quantitativo 02 – Switch
    atualiza_campo("q2_novo_switch", "q2_novo_switch")                    # indica se haverá fornecimento de switch novo
    atualiza_campo("q2_fornecedor_switch", "q2_fornecedor_switch")        # quem fornece o switch: 'fornecedor_interno' ou 'cliente'
    atualiza_campo("q2_modelo_switch", "q2_modelo_switch")                # modelo do switch (novo ou existente)
    atualiza_campo("q2_switch_foto_url", "q2_switch_foto_url")            # URL/caminho da foto do switch
    atualiza_campo("q2_switch_existente_nome", "q2_switch_existente_nome")# identificação do switch existente
    atualiza_campo("q2_observacoes", "q2_observacoes")                    # observações gerais sobre o switch

    # Quantitativo 03 – Cabeamento Óptico
    atualiza_campo("q3_tipo_fibra", "q3_tipo_fibra")                        # tipo de fibra (SM/OMx)
    atualiza_campo("q3_qtd_fibras_por_cabo", "q3_qtd_fibras_por_cabo")      # número de fibras por cabo
    atualiza_campo("q3_tipo_conector", "q3_tipo_conector")                  # tipo de conector (LC/SC etc.)
    atualiza_campo("q3_novo_dio", "q3_novo_dio")                            # se será fornecido novo DIO
    atualiza_campo("q3_caixa_terminacao", "q3_caixa_terminacao")            # se haverá caixa de terminação
    atualiza_campo("q3_caixa_emenda", "q3_caixa_emenda")                    # se haverá caixa de emenda
    atualiza_campo("q3_qtd_cabos", "q3_qtd_cabos")                          # quantidade de cabos ópticos
    atualiza_campo("q3_tamanho_total_m", "q3_tamanho_total_m")              # metragem total estimada (m)
    atualiza_campo("q3_qtd_cordoes_opticos", "q3_qtd_cordoes_opticos")      # quantidade de cordões ópticos
    atualiza_campo("q3_marca_cab_optico", "q3_marca_cab_optico")            # marca do cabeamento óptico
    atualiza_campo("q3_modelo_dio", "q3_modelo_dio")                        # modelo/descrição do DIO
    atualiza_campo("q3_modelo_cordao_optico", "q3_modelo_cordao_optico")    # modelo/descrição dos cordões ópticos
    atualiza_campo("q3_observacoes", "q3_observacoes")                      # observações gerais sobre o cabeamento óptico

    # Quantitativo 04 – Equipamentos (Câmeras / NVR/DVR / Conversor / GBIC)
    atualiza_campo("q4_camera", "q4_camera")                              # indica se a avaliação inclui câmeras
    atualiza_campo("q4_nvr_dvr", "q4_nvr_dvr")                            # indica se haverá NVR/DVR
    atualiza_campo("q4_camera_nova", "q4_camera_nova")                    # True = câmeras novas, False = realocação
    atualiza_campo("q4_camera_modelo", "q4_camera_modelo")                # modelo das câmeras
    atualiza_campo("q4_camera_qtd", "q4_camera_qtd")                      # quantidade de câmeras
    atualiza_campo("q4_camera_fornecedor", "q4_camera_fornecedor")        # quem fornece as câmeras
    atualiza_campo("q4_nvr_dvr_modelo", "q4_nvr_dvr_modelo")              # modelo/descrição do NVR/DVR

    # Quantitativo 05 – Infraestrutura
    atualiza_campo("q5_nova_eletrocalha", "q5_nova_eletrocalha")          # indica se haverá nova eletrocalha
    atualiza_campo("q5_novo_eletroduto", "q5_novo_eletroduto")            # indica se haverá novo eletroduto
    atualiza_campo("q5_novo_rack", "q5_novo_rack")                        # indica se haverá novo rack
    atualiza_campo("q5_instalacao_eletrica", "q5_instalacao_eletrica")    # indica se haverá instalação elétrica
    atualiza_campo("q5_nobreak", "q5_nobreak")                            # indica se haverá nobreak
    atualiza_campo("q5_serralheria", "q5_serralheria")                    # indica se haverá serviços de serralheria
    atualiza_campo("q5_eletrocalha_modelo", "q5_eletrocalha_modelo")      # modelo da eletrocalha
    atualiza_campo("q5_eletrocalha_qtd", "q5_eletrocalha_qtd")            # quantidade de eletrocalhas
    atualiza_campo("q5_eletroduto_modelo", "q5_eletroduto_modelo")        # modelo do eletroduto
    atualiza_campo("q5_eletroduto_qtd", "q5_eletroduto_qtd")              # quantidade de eletrodutos
    atualiza_campo("q5_rack_modelo", "q5_rack_modelo")                    # modelo do rack
    atualiza_campo("q5_rack_qtd", "q5_rack_qtd")                          # quantidade de racks
    atualiza_campo("q5_nobreak_modelo", "q5_nobreak_modelo")              # modelo do nobreak
    atualiza_campo("q5_nobreak_qtd", "q5_nobreak_qtd")                    # quantidade de nobreaks
    atualiza_campo("q5_serralheria_descricao", "q5_serralheria_descricao")# descrição detalhada da serralheria
    atualiza_campo("q5_instalacao_eletrica_obs", "q5_instalacao_eletrica_obs")  # observações adicionais de instalação elétrica

    # ===== Novos campos: Localização / Referências =====
    atualiza_campo("localizacao_imagem1_url", "localizacao_imagem1_url")        # URL da primeira imagem de localização
    atualiza_campo("localizacao_imagem2_url", "localizacao_imagem2_url")        # URL da segunda imagem de localização

    # ===== Novos campos: Pré-requisitos =====
    atualiza_campo("pre_trabalho_altura", "pre_trabalho_altura")                # se há trabalho em altura
    atualiza_campo("pre_plataforma", "pre_plataforma")                          # se precisa de plataforma elevatória
    atualiza_campo("pre_plataforma_modelo", "pre_plataforma_modelo")            # modelo da plataforma
    atualiza_campo("pre_plataforma_dias", "pre_plataforma_dias")                # dias de uso da plataforma
    atualiza_campo("pre_fora_horario_comercial", "pre_fora_horario_comercial")  # se será fora do horário comercial
    atualiza_campo("pre_veiculo_empresa", "pre_veiculo_empresa")              # se usará veículo da empresa
    atualiza_campo("pre_container_materiais", "pre_container_materiais")        # se precisa de container de materiais

    # ===== Novos campos: Horas trabalhadas por função (dias normais) =====
    atualiza_campo("encarregado_dias", "encarregado_dias")                      # atualiza dias de encarregado, se enviados
    atualiza_campo("instalador_dias", "instalador_dias")                        # atualiza dias de instalador, se enviados
    atualiza_campo("auxiliar_dias", "auxiliar_dias")                            # atualiza dias de auxiliar, se enviados
    atualiza_campo("tecnico_de_instalacao_dias", "tecnico_de_instalacao_dias")  # atualiza dias de técnico de instalação
    atualiza_campo("tecnico_em_seguranca_dias", "tecnico_em_seguranca_dias")    # atualiza dias de técnico em segurança

    # ===== Novos campos: Horas extras por função =====
    atualiza_campo("encarregado_hora_extra", "encarregado_hora_extra")          # atualiza horas extras de encarregado
    atualiza_campo("instalador_hora_extra", "instalador_hora_extra")            # atualiza horas extras de instalador
    atualiza_campo("auxiliar_hora_extra", "auxiliar_hora_extra")                # atualiza horas extras de auxiliar
    atualiza_campo("tecnico_de_instalacao_hora_extra", "tecnico_de_instalacao_hora_extra")  # horas extras de técnico de instalação
    atualiza_campo("tecnico_em_seguranca_hora_extra", "tecnico_em_seguranca_hora_extra")    # horas extras de técnico em segurança

    # ===== Novos campos: Trabalho em domingos/feriados por função =====
    atualiza_campo("encarregado_trabalho_domingo", "encarregado_trabalho_domingo")          # atualiza domingos/feriados de encarregado
    atualiza_campo("instalador_trabalho_domingo", "instalador_trabalho_domingo")            # atualiza domingos/feriados de instalador
    atualiza_campo("auxiliar_trabalho_domingo", "auxiliar_trabalho_domingo")                # atualiza domingos/feriados de auxiliar
    atualiza_campo("tecnico_de_instalacao_trabalho_domingo", "tecnico_de_instalacao_trabalho_domingo")  # domingos/feriados técnico instalação
    atualiza_campo("tecnico_em_seguranca_trabalho_domingo", "tecnico_em_seguranca_trabalho_domingo")    # domingos/feriados técnico segurança

    # ===== Novos campos: Alimentação =====
    atualiza_campo("almoco_qtd", "almoco_qtd")                                  # atualiza quantidade de almoços, se enviada
    atualiza_campo("lanche_qtd", "lanche_qtd")                                  # atualiza quantidade de lanches, se enviada

    # ===== Novos campos: Cronograma e prazos =====
    atualiza_campo("cronograma_execucao", "cronograma_execucao")                # atualiza flag de cronograma de execução
    atualiza_campo("dias_instalacao", "dias_instalacao")                        # atualiza quantidade de dias de instalação
    atualiza_campo("as_built", "as_built")                                      # atualiza flag de As Built
    atualiza_campo("dias_entrega_relatorio", "dias_entrega_relatorio")          # atualiza prazo em dias para entrega de relatório
    atualiza_campo("art", "art")                                                # atualiza flag de ART

    # ===== Quantitativo 09 – Painel de Automação =====
    atualiza_campo("q9_tensao_fonte", "q9_tensao_fonte")                        # atualiza tensão da fonte
    atualiza_campo("q9_tensao_fonte_outro", "q9_tensao_fonte_outro")            # atualiza valor customizado de tensão
    atualiza_campo("q9_novo_cabeamento", "q9_novo_cabeamento")                  # atualiza flag de novo cabeamento
    atualiza_campo("q9_tipo_cabeamento", "q9_tipo_cabeamento")                  # atualiza tipo do cabeamento
    atualiza_campo("q9_tipo_cabeamento_outro", "q9_tipo_cabeamento_outro")      # atualiza valor customizado de cabeamento
    atualiza_campo("q9_quantidade_metros", "q9_quantidade_metros")              # atualiza quantidade de metros de cabeamento

    # ===== Quantitativo 10 – Portas (Controle de Acesso) =====
    atualiza_campo("q10_tipo_porta", "q10_tipo_porta")                          # atualiza tipo de porta
    atualiza_campo("q10_servo_motor", "q10_servo_motor")                        # atualiza flag de servo motor
    atualiza_campo("q10_servo_motor_qtd", "q10_servo_motor_qtd")                # atualiza quantidade de servo motores
    atualiza_campo("q10_ponto_eletrico_novo", "q10_ponto_eletrico_novo")        # atualiza flag de ponto elétrico novo
    atualiza_campo("q10_suporte_eletroimã", "q10_suporte_eletroimã")            # atualiza flag de suporte para eletroímã
    atualiza_campo("q10_suporte_eletroimã_qtd", "q10_suporte_eletroimã_qtd")    # atualiza quantidade de suportes
    atualiza_campo("q10_botoeira_saida", "q10_botoeira_saida")                  # atualiza flag de botoeira de saída
    atualiza_campo("q10_botoeira_saida_qtd", "q10_botoeira_saida_qtd")          # atualiza quantidade de botoeiras de saída
    atualiza_campo("q10_botoeira_emergencia", "q10_botoeira_emergencia")        # atualiza flag de botoeira de emergência
    atualiza_campo("q10_botoeira_emergencia_qtd", "q10_botoeira_emergencia_qtd")# atualiza quantidade de botoeiras de emergência
    atualiza_campo("q10_leitor_cartao", "q10_leitor_cartao")                    # atualiza flag de leitor de cartão
    atualiza_campo("q10_leitor_cartao_qtd", "q10_leitor_cartao_qtd")            # atualiza quantidade de leitores de cartão
    atualiza_campo("q10_leitor_facial", "q10_leitor_facial")                    # atualiza flag de leitor facial
    atualiza_campo("q10_leitor_facial_qtd", "q10_leitor_facial_qtd")            # atualiza quantidade de leitores faciais
    atualiza_campo("q10_sensor_presenca", "q10_sensor_presenca")                # atualiza flag de sensor de presença
    atualiza_campo("q10_sensor_presenca_qtd", "q10_sensor_presenca_qtd")        # atualiza quantidade de sensores de presença
    atualiza_campo("q10_sensor_barreira", "q10_sensor_barreira")                # atualiza flag de sensor de barreira
    atualiza_campo("q10_sensor_barreira_qtd", "q10_sensor_barreira_qtd")        # atualiza quantidade de sensores de barreira
    atualiza_campo("q9_observacoes", "q9_observacoes")                          # atualiza observações do painel
    atualiza_campo("q10_observacoes", "q10_observacoes")                        # atualiza observações das portas
    atualiza_campo("q6_modelo", "q6_modelo")                                    # atualiza modelo do equipamento de catraca
    atualiza_campo("q6_quantidade", "q6_quantidade")                            # atualiza quantidade de catracas/torniquetes/cancelas
    atualiza_campo("q6_leitor_facial", "q6_leitor_facial")                      # atualiza flag de leitor facial
    atualiza_campo("q6_leitor_facial_qtd", "q6_leitor_facial_qtd")              # atualiza quantidade de leitores faciais
    atualiza_campo("q6_suporte_leitor_facial", "q6_suporte_leitor_facial")      # atualiza flag de suporte para leitor facial
    atualiza_campo("q6_suporte_leitor_facial_qtd", "q6_suporte_leitor_facial_qtd")  # atualiza quantidade de suportes para leitor facial
    atualiza_campo("q6_leitor_cartao", "q6_leitor_cartao")                      # atualiza flag de leitor de cartão
    atualiza_campo("q6_leitor_cartao_qtd", "q6_leitor_cartao_qtd")              # atualiza quantidade de leitores de cartão
    atualiza_campo("q6_suporte_leitor_cartao", "q6_suporte_leitor_cartao")      # atualiza flag de suporte para leitor de cartão
    atualiza_campo("q6_suporte_leitor_cartao_qtd", "q6_suporte_leitor_cartao_qtd")  # atualiza quantidade de suportes para leitor de cartão
    atualiza_campo("q6_licenca_software", "q6_licenca_software")                # atualiza flag de licença do software
    atualiza_campo("q6_no_break", "q6_no_break")                                # atualiza flag de no break
    atualiza_campo("q6_servidor", "q6_servidor")                                # atualiza flag de servidor
    atualiza_campo("q6_observacoes", "q6_observacoes")                          # atualiza observações de catracas/torniquetes/cancelas

    # ===== Quantitativo 10 – Novos campos (Expansão) =====
    atualiza_campo("q10_eletroimã_fechadura", "q10_eletroimã_fechadura")        # atualiza flag de eletroímã/fechadura
    atualiza_campo("q10_eletroimã_fechadura_modelo", "q10_eletroimã_fechadura_modelo")  # atualiza modelo de eletroímã/fechadura
    atualiza_campo("q10_eletroimã_fechadura_qtd", "q10_eletroimã_fechadura_qtd")  # atualiza quantidade de eletroímãs/fechaduras
    atualiza_campo("q10_mola_hidraulica", "q10_mola_hidraulica")                # atualiza flag de mola hidráulica
    atualiza_campo("q10_mola_hidraulica_tipo", "q10_mola_hidraulica_tipo")      # atualiza tipo de mola hidráulica
    atualiza_campo("q10_mola_hidraulica_qtd", "q10_mola_hidraulica_qtd")        # atualiza quantidade de molas hidráulicas
    atualiza_campo("q10_protecao_botoeira_emergencia_qtd", "q10_protecao_botoeira_emergencia_qtd")  # atualiza proteções para botoeira
    atualiza_campo("q10_botoeira_saida_modelo", "q10_botoeira_saida_modelo")    # atualiza modelo da botoeira de saída
    atualiza_campo("q10_botoeira_emergencia_modelo", "q10_botoeira_emergencia_modelo")  # atualiza modelo da botoeira de emergência
    atualiza_campo("q10_leitor_cartao_modelo", "q10_leitor_cartao_modelo")      # atualiza modelo do leitor de cartão
    atualiza_campo("q10_leitor_facial_modelo", "q10_leitor_facial_modelo")      # atualiza modelo do leitor facial
    atualiza_campo("q10_sensor_presenca_modelo", "q10_sensor_presenca_modelo")  # atualiza modelo do sensor de presença
    atualiza_campo("q10_sensor_barreira_modelo", "q10_sensor_barreira_modelo")  # atualiza modelo do sensor de barreira

    # ===== Quantitativo 06 – Expansão de campos =====
    atualiza_campo("q6_no_break_modelo", "q6_no_break_modelo")                  # atualiza modelo do no-break
    atualiza_campo("q6_no_break_qtd", "q6_no_break_qtd")                        # atualiza quantidade de no-breaks
    atualiza_campo("q6_servidor_modelo", "q6_servidor_modelo")                  # atualiza modelo do servidor
    atualiza_campo("q6_servidor_qtd", "q6_servidor_qtd")                        # atualiza quantidade de servidores

    if not alteracoes:                                           # se a lista de alterações ficou vazia
        # Nenhum campo relevante foi alterado; podemos optar por não registrar auditoria detalhada
        detalhe_log = "Atualização chamada, mas nenhum campo foi alterado."  # mensagem simples de detalhe
    else:
        detalhe_log = json.dumps(                                # converte a lista de alterações em JSON
            {"alteracoes": alteracoes},                          # dicionário com a chave "alteracoes"
            ensure_ascii=False                                   # mantém acentos e caracteres especiais
        )

    # Persiste as alterações no banco
    db.add(avaliacao)                                            # garante que o objeto está na sessão
    db.commit()                                                  # grava as mudanças no banco
    db.refresh(avaliacao)                                        # recarrega o objeto com dados atualizados

    # ====== Atualizar materiais do painel (Q9) se fornecidos ======
    if payload.materiais_painel is not None:                   # se o payload contém materiais do painel (mesmo que vazio)
        # Delete existing materials
        db.query(AvaliacaoMaterialPainel).filter(         # query para encontrar materiais existentes
            AvaliacaoMaterialPainel.avaliacao_id == avaliacao_id  # da avaliação atual
        ).delete()                                              # deleta todos os materiais existentes
        db.commit()                                            # confirma a exclusão

        # Insert new materials
        for material in payload.materiais_painel:              # itera sobre cada novo material
            novo_material = AvaliacaoMaterialPainel(            # instancia um novo material do painel
                avaliacao_id=avaliacao_id,                      # associa à avaliação
                equipamento=material.equipamento.strip(),       # nome do equipamento
                modelo=material.modelo.strip() if material.modelo else None,  # modelo (opcional)
                quantidade=material.quantidade,                 # quantidade
                fabricante=material.fabricante.strip() if material.fabricante else None  # fabricante (opcional)
            )
            db.add(novo_material)                              # adiciona o material à sessão
        db.commit()                                            # grava os novos materiais no banco

        alteracoes.append("materiais_painel")                  # registra a alteração na auditoria

    # Registra o log de auditoria para a atualização
    log = AvaliacaoAuditoria(                                    # instancia um novo registro de auditoria
        avaliacao_id=avaliacao.id,                               # associa à avaliação alterada
        usuario="sistema",                                       # identificador do usuário (ajustar depois para usuário real)
        acao="EDITAR",                                           # tipo de ação
        detalhes=detalhe_log                                     # detalhes do que foi alterado (JSON ou texto)
    )

    db.add(log)                                                  # adiciona o log na sessão
    db.commit()                                                  # grava o log no banco

    return avaliacao                                             # retorna a avaliação atualizada

# -----------------------------------------------------------
# Endpoint opcional: listar auditoria de uma avaliação (somente admin)
# -----------------------------------------------------------
@app.get("/avaliacoes/{avaliacao_id}/auditoria",                 # rota GET /avaliacoes/{id}/auditoria
         response_model=List[AvaliacaoAuditoriaOutSchema])       # resposta: lista de registros de auditoria
def listar_auditoria(                                            # função para listar auditoria de uma avaliação
    avaliacao_id: int,                                           # id da avaliação na rota
    db: Session = Depends(get_db),                               # sessão de banco
    admin: Usuario = Depends(obter_admin_atual)                  # garante que apenas administradores possam acessar
):
    logs = db.query(AvaliacaoAuditoria).filter(                  # monta a query filtrando por avaliacao_id
        AvaliacaoAuditoria.avaliacao_id == avaliacao_id          # condição de filtro
    ).order_by(AvaliacaoAuditoria.data_hora.asc()).all()         # ordena por data/hora (do mais antigo para o mais novo)

    if not logs:                                                 # se não houver logs
        # opcionalmente, podemos checar se a avaliação existe antes de dizer que não há logs
        avaliacao_existe = db.query(Avaliacao).filter(           # checa se existe avaliação com esse id
            Avaliacao.id == avaliacao_id                         # condição de filtro pelo id
        ).first()                                                # pega o primeiro resultado

        if not avaliacao_existe:                                 # se não encontrou avaliação
            raise HTTPException(                                 # lança erro HTTP 404
                status_code=404,                                 # código 404
                detail="Avaliação não encontrada"                # mensagem
            )

    return logs                                                  # retorna a lista de logs (pode ser vazia se não houve ações)
# ====================== fim do main.py ======================

# -----------------------------------------------------------
# Endpoint: listar auditoria de um usuário (somente admin)
# -----------------------------------------------------------
@app.get("/usuarios/{usuario_id}/auditoria",                      # rota GET para listar auditoria de um usuário específico
         response_model=List[UsuarioAuditoriaOutSchema])          # resposta será uma lista de registros de auditoria de usuário
async def listar_auditoria_usuario(                               # função assíncrona que devolve o histórico daquele usuário
    usuario_id: int,                                              # id do usuário alvo vindo da URL
    db: Session = Depends(get_db),                                # sessão de banco injetada pelo FastAPI
    admin: Usuario = Depends(obter_admin_atual)                   # garante que apenas administradores possam acessar
):
    logs = db.query(UsuarioAuditoria).filter(                     # monta a query na tabela de auditoria de usuários
        UsuarioAuditoria.usuario_alvo_id == usuario_id            # filtra somente os registros relativos ao usuário alvo
    ).order_by(UsuarioAuditoria.data_hora.asc()).all()            # ordena por data/hora do mais antigo para o mais recente

    # Opcionalmente, podemos checar se o usuário existe quando não houver logs
    if not logs:                                                  # se a lista de logs vier vazia
        usuario_existe = db.query(Usuario).filter(                # consulta simples para verificar se o usuário existe
            Usuario.id == usuario_id                              # filtra pelo id informado
        ).first()                                                 # pega o primeiro resultado (ou None)

        if not usuario_existe:                                    # se não existir usuário com esse id
            raise HTTPException(                                  # lança erro HTTP 404
                status_code=404,                                  # código de "não encontrado"
                detail="Usuário não encontrado"                   # mensagem para o cliente
            )

    return logs                                                   # retorna a lista de registros (vazia ou não) para o cliente
