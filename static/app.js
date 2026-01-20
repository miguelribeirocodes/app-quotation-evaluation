// ===================== app.js - Frontend Technical Quotation Evaluation =====================
// Este arquivo concentra toda a lógica de frontend da aplicação:
// - Tela de login
// - Armazenamento e uso do token JWT
// - Troca de senha obrigatória no primeiro acesso
// - Listagem e criação de avaliações simples
// ======================================================================

// ------------------------------
// Service Worker (PWA Offline)
// ------------------------------
// Registra o Service Worker para permitir que a aplicação
// funcione offline após o primeiro carregamento.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker
      .register("/static/sw.js")
      .then(function (registration) {
        console.log("[App] Service Worker registrado com sucesso:", registration.scope);
      })
      .catch(function (error) {
        console.warn("[App] Falha ao registrar Service Worker:", error);
      });
  });
}

// ------------------------------
// Configurações básicas
// ------------------------------

// URL base da API. Quando o front é servido pela mesma aplicação FastAPI (ambiente local),
// podemos usar string vazia ("") para chamar a própria origem (ex.: http://127.0.0.1:8000/avaliacoes).
// Quando o front estiver hospedado em outro domínio (ex.: Netlify),
// precisamos apontar explicitamente para a URL pública do backend (Render, por exemplo).
// URL base da API.
// Em desenvolvimento local (frontend servido pelo próprio FastAPI em http://localhost:8000),
// usamos string vazia ("") para chamar a própria origem.
// Em produção (frontend hospedado em outro domínio, como Netlify),
// apontamos explicitamente para a URL pública do backend hospedado no Render.

// -------------------- SUPABASE: Configuração do client --------------------

const SUPABASE_URL = "https://fheaiajnkexvclbarsrj.supabase.co";              // URL do projeto Supabase
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoZWFpYWpua2V4dmNsYmFyc3JqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4NTAzMjIsImV4cCI6MjA4MDQyNjMyMn0.7A1fNcmfY-IkzSgPNs9-dbBkS9CPU8EK1n0C1LzaYpo"; // chave anon pública

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); // inicializa o client Supabase

const SUPABASE_BUCKET_IMAGENS = "avaliacoes-imagens";                          // nome do bucket criado no Storage

/**
 * Faz upload de uma imagem (dataURL) para o Supabase Storage.
 * Retorna a URL pública da imagem ou null em caso de erro.
 *
 * @param {string} dataUrl - imagem em formato dataURL (base64)
 * @param {string} contexto - contexto da imagem (ex.: 'localizacao', 'switch')
 * @param {string} nomeBase - nome base do arquivo (sem extensão)
 * @returns {Promise<string|null>} URL pública da imagem ou null
 */
async function uploadImagemParaStorage(dataUrl, contexto, nomeBase) {
  if (!dataUrl || !dataUrl.startsWith("data:")) {
    console.warn("uploadImagemParaStorage: dataUrl inválido");
    return null;
  }

  try {
    const partes = dataUrl.split(",");
    const mimeMatch = partes[0].match(/:(.*?);/);
    const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
    const base64 = partes[1];
    const byteString = atob(base64);
    const arrayBuffer = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) {
      arrayBuffer[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([arrayBuffer], { type: mimeType });

    const extensao = mimeType.split("/")[1] || "jpg";
    const timestamp = Date.now();
    const nomeArquivo = `${contexto}/${nomeBase}_${timestamp}.${extensao}`;

    const { data, error } = await supabaseClient.storage
      .from(SUPABASE_BUCKET_IMAGENS)
      .upload(nomeArquivo, blob, {
        contentType: mimeType,
        upsert: false
      });

    if (error) {
      console.error("Erro no upload para Supabase Storage:", error);
      return null;
    }

    const { data: urlData } = supabaseClient.storage
      .from(SUPABASE_BUCKET_IMAGENS)
      .getPublicUrl(data.path);

    return urlData.publicUrl || null;
  } catch (err) {
    console.error("Exceção no upload de imagem:", err);
    return null;
  }
}

/**
 * Deleta uma imagem do Supabase Storage a partir da URL pública.
 * Extrai o caminho do arquivo e chama a API de delete.
 *
 * @param {string} publicUrl - URL pública da imagem no Storage
 * @returns {Promise<boolean>} true se deletou, false se falhou
 */
async function deletarImagemDoStorage(publicUrl) {
  if (!publicUrl || typeof publicUrl !== "string") return false;

  try {
    const bucketPath = `/storage/v1/object/public/${SUPABASE_BUCKET_IMAGENS}/`;
    const idx = publicUrl.indexOf(bucketPath);
    if (idx === -1) {
      console.warn("URL não corresponde ao bucket esperado:", publicUrl);
      return false;
    }

    const filePath = publicUrl.substring(idx + bucketPath.length);
    if (!filePath) return false;

    const { data, error } = await supabaseClient.storage
      .from(SUPABASE_BUCKET_IMAGENS)
      .remove([filePath]);

    if (error) {
      console.error("Erro ao deletar imagem do Storage:", error);
      return false;
    }

    return true;
  } catch (err) {
    console.error("Exceção ao deletar imagem:", err);
    return false;
  }
}

/**
 * Comprime uma imagem dataURL para reduzir seu tamanho.
 * Usa Canvas para redimensionar e comprimir a imagem.
 * Retorna uma Promise com o dataURL comprimido.
 *
 * @param {string} dataUrl - imagem em formato dataURL (base64)
 * @param {number} maxWidth - largura máxima da imagem (padrão: 800)
 * @param {number} maxHeight - altura máxima da imagem (padrão: 800)
 * @param {number} quality - qualidade da compressão JPEG (0-1, padrão: 0.6)
 * @returns {Promise<string>} dataURL comprimido
 */
function comprimirImagemParaRascunho(dataUrl, maxWidth = 800, maxHeight = 800, quality = 0.6) {
  return new Promise((resolve, reject) => {
    if (!dataUrl || !dataUrl.startsWith("data:")) {                        // valida se é dataURL válido
      resolve(dataUrl);                                                    // retorna original se não for dataURL
      return;
    }

    const img = new Image();                                               // cria elemento de imagem
    img.crossOrigin = "anonymous";                                         // permite cross-origin se necessário

    img.onload = function() {                                              // quando imagem carregar
      let { width, height } = img;                                         // obtém dimensões originais

      // Calcula novas dimensões mantendo proporção
      if (width > maxWidth || height > maxHeight) {                        // se precisa redimensionar
        const ratio = Math.min(maxWidth / width, maxHeight / height);      // calcula ratio
        width = Math.round(width * ratio);                                 // nova largura
        height = Math.round(height * ratio);                               // nova altura
      }

      const canvas = document.createElement("canvas");                     // cria canvas
      canvas.width = width;                                                // define largura
      canvas.height = height;                                              // define altura

      const ctx = canvas.getContext("2d");                                 // obtém contexto 2D
      ctx.drawImage(img, 0, 0, width, height);                             // desenha imagem redimensionada

      // Converte para JPEG com qualidade reduzida
      const comprimido = canvas.toDataURL("image/jpeg", quality);          // comprime como JPEG
      
      resolve(comprimido);                                                 // retorna dataURL comprimido
    };

    img.onerror = function() {                                             // se falhar ao carregar
      console.warn("[RASCUNHO] Falha ao comprimir imagem, usando original");
      resolve(dataUrl);                                                    // retorna original como fallback
    };

    img.src = dataUrl;                                                     // inicia carregamento
  });
}

/**
 * Comprime múltiplas imagens de forma assíncrona.
 * @param {Array} linhas - array de objetos {id, url, descricao}
 * @returns {Promise<Array>} array com URLs comprimidas
 */
async function comprimirImagensParaRascunho(linhas) {
  const resultado = [];
  for (const linha of linhas) {
    if (!linha.url) {                                                      // se não tem URL
      resultado.push({ ...linha });                                        // mantém como está
      continue;
    }
    
    if (linha.url.startsWith("data:")) {                                   // se for dataURL (base64)
      const comprimida = await comprimirImagemParaRascunho(linha.url);     // comprime
      resultado.push({ ...linha, url: comprimida });                       // adiciona versão comprimida
    } else {                                                               // se for URL normal (já no Storage)
      resultado.push({ ...linha });                                        // mantém como está
    }
  }
  return resultado;
}

// Array global para guardar URLs de imagens pendentes para deleção (Localização)
let localizacaoImagensParaDeletar = [];

// Array global para guardar URLs de imagens pendentes para deleção (Q2 Switch)
let q2SwitchImagensParaDeletar = [];


const API_BASE_URL = (function () {                               // IIFE: função imediatamente executada que calcula a URL base
  const hostname = window.location.hostname;                      // obtém o hostname atual (ex.: "localhost", "quotation-evaluation.netlify.app")

  const isLocalhost =                                             // flag indicando se estamos em ambiente local
    hostname === "localhost" || hostname === "127.0.0.1";         // considera tanto "localhost" quanto "127.0.0.1" como desenvolvimento

  if (isLocalhost) {                                              // se estivermos rodando localmente
    return "";                                                    // usa string vazia: a API é chamada na mesma origem (FastAPI local)
  }

  // Se NÃO for localhost (ou seja, produção no Netlify, por exemplo),
  // usamos a URL pública do backend no Render.
  return "https://quotation-evaluation-backend.onrender.com";       // <-- SUBSTITUA aqui se o seu domínio do Render for outro
})();                                                             // executa a função imediatamente e guarda o resultado em API_BASE_URL

// Log para depuração: mostra qual URL base a aplicação frontend está usando
console.log("API_BASE_URL=", API_BASE_URL);
// Se estiver apontando para Render em outro computador, confirme ALLOWED_ORIGINS no backend

// Variável global para manter o token JWT em memória enquanto a página está aberta.
let authToken = null;

// Variável global para armazenar os dados do usuário logado (nome, se é admin, etc.).
let currentUser = null;

/**
 * Verifica se o usuário atual é administrador.
 * @returns {boolean} true se for admin, false caso contrário
 */
function isAdmin() {
  return currentUser && (currentUser.role === "admin" || currentUser.is_admin === true);
}

/**
 * Verifica se o usuário atual é comercial.
 * @returns {boolean} true se for comercial, false caso contrário
 */
function isComercial() {
  return currentUser && currentUser.role === "comercial";
}

/**
 * Verifica se o usuário atual é admin OU comercial.
 * Útil para permissões que são compartilhadas entre esses dois perfis.
 * @returns {boolean} true se for admin ou comercial, false caso contrário
 */
function isAdminOrComercial() {
  return isAdmin() || isComercial();
}

/**
 * Verifica se o usuário atual é Avaliador (antigo Colaborador).
 */
function isAvaliador() {
  return currentUser && (currentUser.role === "avaliador");
}

/**
 * Verifica se o usuário atual é Visualizador (somente leitura + export/lista).
 */
function isVisualizador() {
  return currentUser && currentUser.role === "visualizador";
}

/**
 * Formata o status para exibição amigável.
 * Converte valores do banco (ex: "em_analise") para formato legível (ex: "Em Análise").
 * @param {string} status - O status vindo do banco de dados
 * @returns {string} O status formatado para exibição
 */
function formatarStatusExibicao(status) {
  const statusFormatado = {
    'aberto': 'Aberto',
    'em_analise': 'Em Análise',
    'aprovado': 'Aprovado',
    'reprovado': 'Reprovado'
  };
  return statusFormatado[status?.toLowerCase()] || status || '';
}

/**
 * Atualiza a permissão de edição do campo Status.
 * Apenas admin e comercial podem alterar o status.
 * Avaliadores veem o campo como somente leitura.
 */
function atualizarPermissaoStatus() {
  const statusSelect = document.getElementById("status");
  if (!statusSelect) return;                                   // se o select não existir, sai

  if (isAdminOrComercial()) {                                  // se for admin ou comercial
    statusSelect.disabled = false;                             // habilita o campo
    statusSelect.title = "";                                   // remove tooltip
    statusSelect.classList.remove("campo-somente-leitura");    // remove estilo de somente leitura
  } else {                                                     // se for avaliador
    statusSelect.disabled = true;                              // desabilita o campo
    statusSelect.title = "Apenas Administrador ou Comercial pode alterar o status";
    statusSelect.classList.add("campo-somente-leitura");       // adiciona estilo visual
  }
}

/**
 * Atualiza a permissão e visibilidade dos campos comerciais (Pedido de Compra e Número da Proposta).
 * - Campos sempre visíveis
 * - Só podem ser editados por admin ou comercial
 */
function atualizarPermissaoCamposComerciais() {
  const container = document.getElementById("campos-comerciais-container");
  const pedidoCompraInput = document.getElementById("pedido-compra");
  const numeroPropostaInput = document.getElementById("numero-proposta");

  if (!container || !pedidoCompraInput || !numeroPropostaInput) return;

  // Campos sempre visíveis
  container.style.display = "";

  // Verifica status atual
  const statusSelect = document.getElementById("status");
  const statusAtual = statusSelect ? statusSelect.value.toLowerCase() : "aberto";

  if (statusAtual === "aberto") {
    // Sempre desabilitado se status for "aberto"
    pedidoCompraInput.disabled = true;
    pedidoCompraInput.classList.add("campo-somente-leitura");
    pedidoCompraInput.title = "Preencha após mudar o status";

    numeroPropostaInput.disabled = true;
    numeroPropostaInput.classList.add("campo-somente-leitura");
    numeroPropostaInput.title = "Preencha após mudar o status";
    return;
  }

  // Se não for "aberto", só admin/comercial pode editar
  if (isAdminOrComercial()) {
    pedidoCompraInput.disabled = false;
    pedidoCompraInput.classList.remove("campo-somente-leitura");
    pedidoCompraInput.title = "";

    numeroPropostaInput.disabled = false;
    numeroPropostaInput.classList.remove("campo-somente-leitura");
    numeroPropostaInput.title = "";
  } else {
    pedidoCompraInput.disabled = true;
    pedidoCompraInput.classList.add("campo-somente-leitura");
    pedidoCompraInput.title = "Apenas Administrador ou Comercial pode preencher";

    numeroPropostaInput.disabled = true;
    numeroPropostaInput.classList.add("campo-somente-leitura");
    numeroPropostaInput.title = "Apenas Administrador ou Comercial pode preencher";
  }
}

/**
 * Aplica regras de interface para um usuário Visualizador:
 * - desabilita todos os inputs/ selects/ textareas do formulário de avaliação
 * - oculta/ desabilita botões de ação (salvar, novo, rascunho, adicionar linha)
 * - mantém visíveis e habilitados apenas os botões de exportar PDF e gerar lista de materiais
 */
function aplicarPermissoesUsuarioUI() {
  if (!formAvaliacao) return;

  if (isVisualizador()) {
    // Desabilita campos do formulário
    const campos = formAvaliacao.querySelectorAll("input, select, textarea");
    campos.forEach((c) => {
      try {
        c.disabled = true;
        if (c.tagName.toLowerCase() === 'input' && (c.type === 'text' || c.type === 'date' || c.type === 'email' || c.type === 'number' || c.type === 'password')) {
          c.readOnly = true;
        }
        c.classList.add("campo-somente-leitura");
      } catch (e) {}
    });

    // Esconde/ desabilita botões de ação que alteram a avaliação
    const bloqueados = [salvarAvaliacaoButton, salvarRascunhoButton, novaAvaliacaoButton, document.getElementById('btn-infra-adicionar-linha')];
    bloqueados.forEach((b) => {
      if (!b) return;
      b.style.display = 'none';
      b.disabled = true;
    });

    // Esconde botão Auditoria (auditoria só para admin)
    if (btnAuditoria) {
      btnAuditoria.classList.add('hidden');
      if (secAuditoria) secAuditoria.style.display = 'none';
    }

    // Garante que export e lista fiquem visíveis (já controlados por outras funções)
    if (btnGerarListaMateriais) btnGerarListaMateriais.style.display = 'inline-block';
    if (btnExportarPDF) btnExportarPDF.style.display = 'inline-block';
    // Esconde a seção de rascunhos e controles relacionados para visualizador
    try {
      const rascunhosCard = document.querySelector('.card-list-rascunho');
      if (rascunhosCard) rascunhosCard.style.display = 'none';
      const badge = document.getElementById('rascunhos-count-badge'); if (badge) badge.style.display = 'none';
      const recarregar = document.getElementById('btn-recarregar-rascunhos'); if (recarregar) recarregar.style.display = 'none';
      const limpar = document.getElementById('btn-limpar-rascunhos'); if (limpar) limpar.style.display = 'none';
      const tbody = document.getElementById('rascunhos-tbody'); if (tbody) tbody.style.display = 'none';
    } catch (e) {}
  } else {
    // Se não for visualizador, restaura visibilidade e habilita campos do formulário
    if (salvarAvaliacaoButton) { salvarAvaliacaoButton.style.display = ''; salvarAvaliacaoButton.disabled = false; }
    if (salvarRascunhoButton) { salvarRascunhoButton.style.display = ''; salvarRascunhoButton.disabled = false; }
    if (novaAvaliacaoButton) { novaAvaliacaoButton.style.display = ''; novaAvaliacaoButton.disabled = false; }

    // Restaura visibilidade dos controles de rascunhos quando não for visualizador
    try {
      const rascunhosCard = document.querySelector('.card-list-rascunho');
      if (rascunhosCard) rascunhosCard.style.display = '';
      const badge = document.getElementById('rascunhos-count-badge'); if (badge) badge.style.display = '';
      const recarregar = document.getElementById('btn-recarregar-rascunhos'); if (recarregar) recarregar.style.display = '';
      const limpar = document.getElementById('btn-limpar-rascunhos'); if (limpar) limpar.style.display = '';
      const tbody = document.getElementById('rascunhos-tbody'); if (tbody) tbody.style.display = '';
    } catch (e) {}

    // Re-habilita todos os campos do formulário (inputs, selects, textareas)
    try {
      const campos = formAvaliacao.querySelectorAll("input, select, textarea");
      campos.forEach((c) => {
        try {
          c.disabled = false;
          if (c.tagName.toLowerCase() === 'input' && (c.type === 'text' || c.type === 'date' || c.type === 'email' || c.type === 'number' || c.type === 'password')) {
            c.readOnly = false;
          }
          c.classList.remove("campo-somente-leitura");
        } catch (e) {}
      });
    } catch (e) {}

    if (btnGerarListaMateriais) atualizarVisibilidadeBotaoGerarLista();
    if (btnExportarPDF) atualizarVisibilidadeBotaoExportarPDF();
    atualizarVisibilidadeBotaoAuditoria();
  }
}

// Variável global para controlar se estamos editando uma avaliação existente (id diferente de null)
// ou criando uma nova (valor null).
let avaliacaoEmEdicaoId = null; // mantém o id da avaliação que está sendo editada (null significa "nova avaliação")
let avaliacaoEmEdicaoCodigo = null; // mantém o código da avaliação em edição (ex: "AV-001")

// Constante com a chave usada no localStorage para guardar a lista de rascunhos de avaliações.
const DRAFTS_STORAGE_KEY = "quotation_evaluation_avaliacoes_rascunhos_v1"; // chave única no localStorage para armazenar todos os rascunhos do sistema

// Constante para tamanho máximo de arquivo de imagem (em bytes)
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_FILE_SIZE_MB = 10; // para exibição na mensagem de erro

const SESSION_MARKER_KEY = "nt_avaliacoes_had_session"; // chave usada no localStorage para indicar se este navegador já teve uma sessão autenticada
// Quando o usuário faz login com sucesso, gravamos "1" nessa chave.
// Quando o usuário faz logout manual, removemos essa chave.
// Assim conseguimos diferenciar "primeiro acesso" de "sessão expirada" ao abrir a página.

// Variável global para manter o id do rascunho atualmente associado ao formulário em edição.
let rascunhoEmEdicaoId = null; // guarda o identificador do rascunho local vinculado ao formulário (null quando não há rascunho carregado)

// Intervalo de tempo (em milissegundos) usado para o salvamento automático de rascunhos.
const AUTO_SAVE_DELAY_MS = 2000; // define um atraso de 2 segundos após a última digitação antes de salvar automaticamente

// Variável para armazenar o identificador do timer de autosave (retornado por setTimeout).
let autoSaveTimeoutId = null; // permite cancelar o salvamento automático anterior antes de agendar um novo

/**
 * Verifica se o formulário de avaliação está "vazio" do ponto de vista de rascunho.
 * Usa o objeto "valores" montado em coletarEstadoFormularioComoRascunho().
 * Se só tiver campos técnicos/ocultos ou tudo em branco, devolve true.
 */
function formularioRascunhoEstaVazio(valores) {
  if (!valores || typeof valores !== "object") {
    return true;
  }

  const idsIgnorados = [                                              // lista de ids de campos que não contam como "preenchimento real"
    "rascunho-id",                                                    // id do campo oculto que guarda o id do rascunho
    "tipo-formulario",                                                // id do campo oculto que guarda o tipo de formulário (UTP/Fibra x Câmeras)
    "avaliacao-id",                                                   // id de eventual campo oculto técnico da avaliação (se existir)
  ];

  const chaves = Object.keys(valores);                                // obtém a lista de ids de campos presentes no objeto de valores

  for (let i = 0; i < chaves.length; i++) {                           // percorre cada chave (id de campo) encontrada
    const idCampo = chaves[i];                                        // guarda o id atual para facilitar leitura

    if (!Object.prototype.hasOwnProperty.call(valores, idCampo)) {    // garante que a chave é realmente própria do objeto (não herdada)
      continue;                                                       // se não for própria, ignora e passa para a próxima
    }

    if (idsIgnorados.indexOf(idCampo) !== -1) {                       // se este id está na lista de campos ignorados
      continue;                                                       // não conta como preenchimento e avança para o próximo
    }

    const valor = valores[idCampo];                                   // obtém o valor associado a este campo

    // Tratamento especial para o campo "status"
    if (idCampo === "status") {
      const statusVal = (valor || "").toString().trim();
      if (statusVal === "" || statusVal === "aberto") {
        continue;
      }
      encontrouAlgumPreenchido = true;
      break;
    }

    if (typeof valor === "boolean") {                                 // se o valor for booleano (tipicamente checkbox)
      if (valor === true) {                                           // se o checkbox estiver marcado
        return false;                                                 // já consideramos que o formulário não está vazio
      }
      continue;                                                       // se for false, ignora e segue avaliando os demais campos
    }

    if (valor === null || valor === undefined) {                      // se for null ou undefined
      continue;                                                       // não conta como preenchimento
    }

    if (typeof valor === "string") {                                  // se o valor for uma string
      if (valor.trim() !== "") {                                      // verifica se, depois de remover espaços, sobrou algum conteúdo
        return false;                                                 // se houver texto, consideramos que o formulário não está vazio
      }
      continue;                                                       // se a string estiver vazia, ignora e passa para o próximo campo
    }

    if (typeof valor === "number") {                                  // se o valor for numérico
      if (!Number.isNaN(valor) && valor !== 0) {                      // se não for NaN e for diferente de zero
        return false;                                                 // consideramos que há um valor relevante preenchido
      }
      continue;                                                       // se for 0 ou NaN, tratamos como ausência de valor
    }

    if (valor) {                                                      // para outros tipos, qualquer valor "truthy" conta como preenchido
      return false;                                                   // assim que encontramos um valor truthy, encerramos indicando que não está vazio
    }
  }

  return true;                                                        // se percorremos todos os campos sem encontrar nada relevante, o formulário é considerado vazio
}

/**
 * Lê do localStorage a lista bruta de rascunhos salvos.
 * O retorno é sempre um array; em caso de erro, cai para [].
 */
function lerRascunhosDoStorage() {
  const valorBruto = window.localStorage.getItem(DRAFTS_STORAGE_KEY); // lê a string JSON armazenada sob a chave de rascunhos
  //window.localStorage.clear(); //limpar para debug
  if (!valorBruto) { // se não existir nada salvo ainda
    return []; // devolve lista vazia para simplificar o uso pelos chamadores
  }
  try {
    const lista = JSON.parse(valorBruto); // tenta converter a string JSON em objeto JavaScript
    if (Array.isArray(lista)) { // garante que o valor seja de fato um array
      return lista; // retorna a lista de rascunhos lida do storage
    }
    return []; // se o formato não for um array, devolve lista vazia para evitar erros de execução
  } catch (error) {
    console.error("Erro ao ler rascunhos do localStorage:", error); // registra o erro no console para debug
    return []; // em caso de falha no parse, devolve uma lista vazia e segue o fluxo
  }
}

/**
 * Salva no localStorage a lista completa de rascunhos.
 */
function gravarRascunhosNoStorage(listaRascunhos) {
  try {
    const texto = JSON.stringify(listaRascunhos); // converte o array de rascunhos em string JSON
    window.localStorage.setItem(DRAFTS_STORAGE_KEY, texto); // grava a string JSON no localStorage na chave configurada
  } catch (error) {
    console.error("Erro ao salvar rascunhos no localStorage:", error); // registra o erro se algo impedir a gravação (ex.: cota cheia)
  }
}

/**
 * Retorna os rascunhos visíveis para o contexto atual.
 * - Se modo offline: retorna rascunhos sem user_id (criados offline)
 * - Se modo online: retorna rascunhos do usuário logado + rascunhos sem user_id (para permitir sincronização)
 */
function obterRascunhosDoUsuarioAtual() {
  const todos = lerRascunhosDoStorage(); // carrega todos os rascunhos existentes no storage
  
  // Modo offline: retorna apenas rascunhos sem user_id
  if (modoOfflineAtivo || !currentUser || typeof currentUser.id !== "number") {
    return todos.filter((r) => !r.user_id); // retorna apenas rascunhos que não possuem user_id associado
  }
  
  // Modo online: retorna rascunhos do usuário + rascunhos sem user_id (criados offline)
  const idUsuario = currentUser.id; // guarda o id do usuário logado
  return todos.filter((r) => r.user_id === idUsuario || !r.user_id); // inclui rascunhos do usuário e os criados offline
}

/**
 * Cria ou atualiza um rascunho local no navegador.
 * - Se rascunhoParcial.id existir e estiver na lista, atualiza aquele rascunho.
 * - Caso contrário, cria um novo com id gerado automaticamente.
 *
 * Retorna sempre o rascunho completo (com id, timestamps e user_id).
 */
function salvarOuAtualizarRascunhoLocal(rascunhoParcial) {
  const todos = lerRascunhosDoStorage(); // busca todos os rascunhos já salvos
  const agora = new Date().toISOString(); // gera timestamp ISO para marcação de criação/atualização
  let idUsuario = null; // inicializa o id do usuário associado ao rascunho

  if (currentUser && typeof currentUser.id === "number") { // se tivermos um usuário logado com id definido
    idUsuario = currentUser.id; // usa o id retornado pelo backend como dono do rascunho
  }

  let rascunhoExistente = null; // variável para armazenar eventual rascunho já existente com o mesmo id
  if (rascunhoParcial && rascunhoParcial.id) { // se o objeto parcial possuir um campo id
    rascunhoExistente = todos.find((item) => item.id === rascunhoParcial.id); // procura na lista um rascunho com esse mesmo id
  }

  if (!rascunhoExistente) { // se nenhum rascunho foi encontrado (novo rascunho)
    const novoId =
      (rascunhoParcial && rascunhoParcial.id) || "draft-" + Date.now(); // gera um id simples baseado no horário atual, se não vier um explícito

    const novoRascunho = {
      id: novoId, // identificador único do rascunho
      user_id: idUsuario, // id do usuário dono do rascunho (pode ser null se ainda não houver login)
      criado_em: agora, // data/hora de criação no formato ISO
      atualizado_em: agora, // data/hora de última atualização no formato ISO
      ...rascunhoParcial, // espalha os demais campos específicos do rascunho (ex.: dados do formulário, rótulos)
    };

    todos.push(novoRascunho); // adiciona o novo rascunho à lista total
    gravarRascunhosNoStorage(todos); // persiste a lista atualizada no localStorage
    return novoRascunho; // devolve o rascunho completo (já com id e timestamps)
  }

  const rascunhosAtualizados = todos.map((item) => {
    // percorre todos os rascunhos existentes
    if (item.id !== rascunhoExistente.id) {
      // se o id não for o que queremos atualizar
      return item; // mantém o rascunho inalterado
    }
    return {
      ...item, // reaproveita todos os campos atuais do rascunho
      ...rascunhoParcial, // substitui/insere os campos vindos no objeto parcial
      user_id: idUsuario, // garante que o rascunho permaneça associado ao usuário atual
      atualizado_em: agora, // atualiza o timestamp de última modificação
    }; // retorna o rascunho já atualizado
  });

  gravarRascunhosNoStorage(rascunhosAtualizados); // grava a nova lista com o rascunho atualizado

  return rascunhosAtualizados.find(
    (item) => item.id === (rascunhoParcial && rascunhoParcial.id)
  ); // retorna o rascunho atualizado encontrado na lista
}

/**
 * Remove definitivamente um rascunho local a partir do seu id.
 */
function excluirRascunhoLocalPorId(idRascunho) {
  const todos = lerRascunhosDoStorage(); // lê a lista de todos os rascunhos do storage
  const filtrados = todos.filter((item) => item.id !== idRascunho); // filtra removendo o item cujo id foi informado
  gravarRascunhosNoStorage(filtrados); // persiste a nova lista sem o rascunho excluído
}

// ------------------------------
// Seletores de elementos de tela
// ------------------------------

// Seções principais (telas) do SPA.
const loginScreen = document.getElementById("login-screen"); // tela de login
const appScreen = document.getElementById("app-screen"); // tela principal da aplicação

// Flag global para indicar se estamos em modo offline
let modoOfflineAtivo = false;

// Formulário e campos de login.
const loginForm = document.getElementById("login-form"); // formulário de login
const loginUsernameInput = document.getElementById("login-username"); // input de usuário
const loginPasswordInput = document.getElementById("login-password"); // input de senha
const loginCapsLockWarningEl = document.getElementById("login-capslock-warning"); // aviso "Caps Lock ativado"
const loginErrorEl = document.getElementById("login-error"); // parágrafo para mostrar erros de login
const loginSubmitButton = document.getElementById("btn-login"); // botão de login normal
const btnLoginOffline = document.getElementById("btn-login-offline"); // botão de login offline

// Elementos relacionados ao usuário logado no topo da aplicação.
const userNameEl = document.getElementById("user-name"); // span com o nome do usuário
const userRoleEl = document.getElementById("user-role"); // span com a função (admin/avaliador)
const offlineBadge = document.getElementById("offline-badge"); // badge indicador de modo offline
const logoutButton = document.getElementById("btn-logout"); // botão "Sair"

// Elementos da lista de avaliações.
const recarregarButton = document.getElementById("btn-recarregar"); // botão para recarregar lista
const avaliacoesTbody = document.getElementById("avaliacoes-tbody"); // corpo da tabela com as avaliações

// Elementos do formulário de avaliação.
// Elementos do formulário de avaliação.
const formAvaliacao = document.getElementById("form-avaliacao"); // formulário de nova avaliação
const rascunhoIdInput = document.getElementById("rascunho-id"); // input oculto que armazena o id do rascunho vinculado ao formulário
const clienteNomeInput = document.getElementById("cliente-nome"); // select com nome do cliente (lista fixa + opção "Outro")
const clienteNomeOutroInput = document.getElementById("cliente-nome-outro"); // input de texto para o caso "Outro"
const clienteOutroWrapper = document.getElementById("cliente-outro-wrapper"); // wrapper usado para mostrar/ocultar o campo "Outro"
const dataAvaliacaoInput = document.getElementById("data-avaliacao"); // input de data da avaliação
const localInput = document.getElementById("local"); // input de local
const objetoInput = document.getElementById("objeto"); // input de objeto
const statusSelect = document.getElementById("status"); // select de status
const equipeSelect = document.getElementById("equipe"); // select de equipe
const responsavelInput = document.getElementById("responsavel-avaliacao"); // input de responsável
const contatoInput = document.getElementById("contato-cliente"); // input de contato do cliente
const emailClienteInput = document.getElementById("email-cliente"); // input de e-mail do cliente
const escopoTextarea = document.getElementById("escopo-texto");     // textarea de escopo / observações
//tipo_formulario
const tipoFormularioInput = document.getElementById("tipo-formulario");         // input hidden que armazena o tipo atual de formulário selecionado (backward compat)
const tipoFormularioSelect = document.getElementById("tipo-formulario-select"); // dropdown selector para tipo de formulário
// const tabButtons = document.querySelectorAll(".avaliacao-tab-btn");          // REMOVIDO: substituído por dropdown
const blocosTipoRedes = document.querySelectorAll(".tipo-redes-only");          // blocos exclusivos do formulário UTP/Fibra (legado "Redes")
const blocosTipoCamera = document.querySelectorAll(".tipo-camera-only");        // blocos exclusivos do formulário de Câmeras (legado "Infraestrutura")
const blocosTipoCA = document.querySelectorAll(".tipo-ca-only");                // blocos exclusivos do formulário de Controle de Acesso
//tipo_formulario

// ===================== CONFIGURAÇÃO DE TIPOS DE FORMULÁRIO =====================
// Objeto centralizado que mapeia cada tipo aos seus blocos visíveis/ocultos
const FORM_TYPE_CONFIG = {
  utp_fibra: {
    label: "UTP e Fibra Óptica",
    legacyAliases: ["redes", "utp-fibra", "utp"],
    visibleSections: ["tipo-redes-cameras-comum", "tipo-redes-only"],
    hiddenSections: ["tipo-camera-only", "tipo-ca-only"]
  },
  cameras: {
    label: "Câmeras",
    legacyAliases: ["infraestrutura", "infra", "câmeras"],
    visibleSections: ["tipo-redes-cameras-comum", "tipo-camera-only"],
    hiddenSections: ["tipo-redes-only", "tipo-ca-only"]
  },
  controle_acesso: {
    label: "Controle de Acesso",
    legacyAliases: ["ca", "acesso"],
    visibleSections: ["tipo-ca-only"],
    hiddenSections: ["tipo-redes-cameras-comum", "tipo-redes-only", "tipo-camera-only"]
  }
};

// Função que normaliza valores legados para os tipos oficiais
function normalizarTipoFormulario(tipoRaw) {
  const tipo = (tipoRaw || "").toString().toLowerCase().trim();

  // Verifica se já é um tipo válido
  if (FORM_TYPE_CONFIG[tipo]) {
    return tipo;
  }

  // Procura nos aliases legados
  for (const [key, config] of Object.entries(FORM_TYPE_CONFIG)) {
    if (config.legacyAliases.includes(tipo)) {
      return key;
    }
  }

  // Fallback padrão
  return "utp_fibra";
}
//tipo_formulario
// ===================== CAMPOS NOVOS =====================

// ===================== CAMPOS NOVOS =====================

// Flags gerais do serviço
const servicoForaMC = document.getElementById("servico-fora-montes-claros"); // checkbox serviço fora de Montes Claros
const servicoIntermediario = document.getElementById("servico-intermediario"); // checkbox serviço para intermediário

// Quantitativo 01 – Patch Panel / Cabeamento
// Quantitativo 01 – Patch Panel / Cabeamento
const q1Categoria = document.getElementById("q1-categoria-cab");              // select de categoria do cabeamento (CAT5e/CAT6/CAT6A)
const q1Blindado = document.getElementById("q1-blindado");                    // select Sim/Não: cabeamento blindado?
const q1NovoPatch = document.getElementById("q1-novo-patch-panel");           // select Sim/Não: necessita novo patch panel?
const q1IncluirGuia = document.getElementById("q1-incluir-guia");             // select Sim/Não: incluir guia de cabos?
const q1QtdGuiasCabos = document.getElementById("q1-qtd-guias-cabos");        // input numérico para quantidade de guias de cabos
const q1QtdGuiasCabosWrapper = document.getElementById("q1-qtd-guias-cabos-wrapper"); // wrapper da quantidade de guias de cabos (controla visibilidade)
const q1QtdPontosRede = document.getElementById("q1-qtd-pontos-rede");        // input numérico: quantidade de pontos de rede
const q1QtdCabos = document.getElementById("q1-qtd-cabos");                   // input numérico: quantidade de cabos
const q1QtdPortasPP = document.getElementById("q1-qtd-portas-patch-panel");   // input numérico: quantidade de portas no patch panel
const q1QtdPatchCords = document.getElementById("q1-qtd-patch-cords");        // input numérico: quantidade de patch cords

const q1ModeloPatchPanel = document.getElementById("q1-modelo-patch-panel");  // select: modelo do patch panel (CommScope/Furukawa/Systimax/Outro)
const q1ModeloPatchPanelOutroInput = document.getElementById(                 // input texto: descrição do modelo quando a opção "Outro" for usada
  "q1-modelo-patch-panel-outro"
);
const q1ModeloPatchPanelWrapper = document.getElementById("q1-modelo-patch-panel-wrapper"); // linha contendo os campos de modelo de patch panel
const q1ModeloPatchPanelOutroWrapper = document.getElementById(              // wrapper do campo "Outro" para modelo de patch panel
  "q1-modelo-patch-panel-outro-wrapper"
);
const q1MarcaCab = document.getElementById("q1-marca-cab");                   // select para marca do cabeamento UTP (CommScope/Furukawa/Outro)
const q1MarcaCabOutroInput = document.getElementById("q1-marca-cab-outro");   // input de texto para a marca quando for "Outro"
const q1MarcaCabOutroWrapper = document.getElementById("q1-marca-cab-outro-wrapper"); // wrapper do campo "Outro" de marca
const q1PatchCordsModelo = document.getElementById("q1-patch-cords-modelo");        // select: modelo dos patch cords (comprimentos padrão)
const q1PatchCordsCor = document.getElementById("q1-patch-cords-cor");              // select: cor dos patch cords (padrões de cor)
const q1PatchPanelExistenteNome = document.getElementById(                    // input de texto para identificar o patch panel existente
  "q1-patch-panel-existente-nome"
);

// Quantitativo 02 – Switch
const q2NovoSwitch = document.getElementById("q2-novo-switch");                 // select Sim/Não indicando se precisa de switch novo
const q2FornecedorSwitchWrapper = document.getElementById("q2-fornecedor-switch-wrapper"); // wrapper do campo "Fornecedor do switch"
const q2FornecedorSwitch = document.getElementById("q2-fornecedor-switch");      // select: fornecedor do switch ("quotation_evaluation" ou "cliente")
const q2ModeloSwitch = document.getElementById("q2-modelo-switch");             // input texto: modelo do switch
const q2SwitchFotoUrl = document.getElementById("q2-switch-foto-url");          // input texto: URL da foto do switch
const q2ObsSwitch = document.getElementById("q2-observacoes");                  // textarea: observações sobre switches

// Quantitativo 03 – Cabeamento Óptico
const q3TipoFibra = document.getElementById("q3-tipo-fibra");                   // select: tipo de fibra (SM/OMx)
const q3QtdFibrasPorCabo = document.getElementById("q3-qtd-fibras-por-cabo");  // select: número de fibras por cabo
const q3TipoConector = document.getElementById("q3-tipo-conector");            // select: tipo de conector (LC/SC/ST/MTRJ)
const q3NovoDio = document.getElementById("q3-novo-dio");                       // select: pergunta se é necessário novo DIO
const q3ModeloDio = document.getElementById("q3-modelo-dio");                   // input texto: modelo do DIO
const q3ModeloDioWrapper = document.getElementById("q3-modelo-dio-wrapper");    // wrapper do campo de modelo do DIO
const q3CaixaTerminacao = document.getElementById("q3-caixa-terminacao");      // select Sim/Não: caixa de terminação?
const q3CaixaEmenda = document.getElementById("q3-caixa-emenda");              // select Sim/Não: caixa de emenda?
const q3QtdCabos = document.getElementById("q3-qtd-cabos");                    // input numérico: quantidade de cabos ópticos
const q3TamanhoTotal = document.getElementById("q3-tamanho-total-m");          // input numérico: metragem total em metros
const q3QtdCordoesOpticos = document.getElementById("q3-qtd-cordoes-opticos"); // input numérico: quantidade de cordões ópticos
const q3MarcaCabOptico = document.getElementById("q3-marca-cab-optico");           // select: marca do cabo óptico (Furukawa/CommScope/Outro)
const q3MarcaCabOpticoOutroInput = document.getElementById("q3-marca-cab-optico-outro"); // input texto para marca "Outro"
const q3MarcaCabOpticoOutroWrapper = document.getElementById("q3-marca-cab-optico-outro-wrapper"); // wrapper do campo "Outro" de marca óptica
const q3ModeloCordaoOptico = document.getElementById("q3-modelo-cordao-optico"); // input texto: modelo do cordão óptico
const q3Obs = document.getElementById("q3-observacoes");                       // textarea: observações sobre fibra óptica

// Quantitativo 04 – Equipamentos
const q4Camera = document.getElementById("q4-camera");                     // select Sim/Não indicando se há câmeras no projeto
const q4NvrDvr = document.getElementById("q4-nvr-dvr");                   // select Sim/Não indicando se há NVR/DVR
const q4CameraNova = document.getElementById("q4-camera-nova");           // select Sim/Não: indica se a câmera é nova/realocação
const q4CameraNovaWrapper = document.getElementById("q4-camera-nova-wrapper");
const q4CameraFornecedor = document.getElementById("q4-camera-fornecedor"); // select: fornecedor da câmera (quotation_evaluation/cliente)
const q4CameraModelo = document.getElementById("q4-camera-modelo");       // input texto: modelo da câmera
const q4CameraModeloWrapper = document.getElementById("q4-camera-modelo-wrapper");
const q4CameraQtd = document.getElementById("q4-camera-qtd");             // input numérico: quantidade de câmeras
const q4CameraQtdWrapper = document.getElementById("q4-camera-qtd-wrapper");
const q4NvrDvrModelo = document.getElementById("q4-nvr-dvr-modelo");      // input texto: modelo do NVR/DVR
const q4NvrDvrModeloWrapper = document.getElementById("q4-nvr-dvr-modelo-wrapper");

// Quantitativo 05 – Infraestrutura
const q5NovaEletrocalha = document.getElementById("q5-nova-eletrocalha");           // select Sim/Não: nova eletrocalha?
const q5NovoEletroduto = document.getElementById("q5-novo-eletroduto");             // select Sim/Não: novo eletroduto?
const q5NovoRack = document.getElementById("q5-novo-rack");                         // select Sim/Não: novo rack?
const q5InstalacaoEletrica = document.getElementById("q5-instalacao-eletrica");     // select Sim/Não: instalação elétrica?
const q5Nobreak = document.getElementById("q5-nobreak");                            // select Sim/Não: nobreak?
const q5Serralheria = document.getElementById("q5-serralheria");                    // select Sim/Não: serralheria?

const q5EletrocalhaModelo = document.getElementById("q5-eletrocalha-modelo");       // input texto: modelo da eletrocalha
const q5EletrocalhaQtd = document.getElementById("q5-eletrocalha-qtd");             // input numérico: quantidade de eletrocalhas
const q5EletrodutoModelo = document.getElementById("q5-eletroduto-modelo");         // input texto: modelo do eletroduto
const q5EletrodutoQtd = document.getElementById("q5-eletroduto-qtd");               // input numérico: quantidade de eletrodutos
const q5RackModelo = document.getElementById("q5-rack-modelo");                     // input texto: modelo do rack
const q5RackQtd = document.getElementById("q5-rack-qtd");                           // input numérico: quantidade de racks
const q5NobreakModelo = document.getElementById("q5-nobreak-modelo");               // input texto: modelo do nobreak
const q5NobreakQtd = document.getElementById("q5-nobreak-qtd");                     // input numérico: quantidade de nobreaks
const q5SerralheriaDescricao = document.getElementById("q5-serralheria-descricao"); // textarea: descrição da serralheria
const q5InstalacaoEletricaObs = document.getElementById("q5-instalacao-eletrica-obs"); // textarea: observações da instalação elétrica

// Quantitativo 09 - Análise de Painel de Automação (Controle de Acesso)
const q9TensaoFonte = document.getElementById("q9-tensao-fonte");
const q9TensaoFonteOutro = document.getElementById("q9-tensao-fonte-outro");
const q9TensaoFonteOutroWrapper = document.getElementById("q9-tensao-fonte-outro-wrapper");
const q9NovoCabeamento = document.getElementById("q9-novo-cabeamento");
const q9TipoCabeamento = document.getElementById("q9-tipo-cabeamento");
const q9TipoCabeamentoWrapper = document.getElementById("q9-tipo-cabeamento-wrapper");
const q9TipoCabeamentoOutro = document.getElementById("q9-tipo-cabeamento-outro");
const q9TipoCabeamentoOutroWrapper = document.getElementById("q9-tipo-cabeamento-outro-wrapper");
const q9QuantidadeMetros = document.getElementById("q9-quantidade-metros");
const q9QuantidadeMetrosWrapper = document.getElementById("q9-quantidade-metros-wrapper");

// Q9 - Tabela de Materiais do Painel
const q9MateriaisPainelTabela = document.getElementById("q9-materiais-painel-tabela");
const q9MateriaisPainelTbody = document.getElementById("q9-materiais-painel-tbody");
const btnQ9AdicionarLinha = document.getElementById("btn-q9-adicionar-linha");

// Quantitativo 10 - Portas (Controle de Acesso)
const q10TipoPorta = document.getElementById("q10-tipo-porta");
const q10ServoMotor = document.getElementById("q10-servo-motor");
const q10ServoMotorWrapper = document.getElementById("q10-servo-motor-wrapper");
const q10ServoMotorQtd = document.getElementById("q10-servo-motor-qtd");
const q10ServoMotorQtdWrapper = document.getElementById("q10-servo-motor-qtd-wrapper");
const q10PontoEletricoNovo = document.getElementById("q10-ponto-eletrico-novo");
const q10SuporteEletroima = document.getElementById("q10-suporte-eletroimã");
const q10SuporteEletroimaQtd = document.getElementById("q10-suporte-eletroimã-qtd");
const q10SuporteEletroimaQtdWrapper = document.getElementById("q10-suporte-eletroimã-qtd-wrapper");
const q10BotoeiraSaida = document.getElementById("q10-botoeira-saida");
const q10BotoeiraSaidaQtd = document.getElementById("q10-botoeira-saida-qtd");
const q10BotoeiraSaidaQtdWrapper = document.getElementById("q10-botoeira-saida-qtd-wrapper");
const q10BotoeiraEmergencia = document.getElementById("q10-botoeira-emergencia");
const q10BotoeiraEmergenciaQtd = document.getElementById("q10-botoeira-emergencia-qtd");
const q10BotoeiraEmergenciaQtdWrapper = document.getElementById("q10-botoeira-emergencia-qtd-wrapper");
const q10LeitorCartao = document.getElementById("q10-leitor-cartao");
const q10LeitorCartaoQtd = document.getElementById("q10-leitor-cartao-qtd");
const q10LeitorCartaoQtdWrapper = document.getElementById("q10-leitor-cartao-qtd-wrapper");
const q10LeitorFacial = document.getElementById("q10-leitor-facial");
const q10LeitorFacialQtd = document.getElementById("q10-leitor-facial-qtd");
const q10LeitorFacialQtdWrapper = document.getElementById("q10-leitor-facial-qtd-wrapper");
const q10SensorPresenca = document.getElementById("q10-sensor-presenca");
const q10SensorPresencaQtd = document.getElementById("q10-sensor-presenca-qtd");
const q10SensorPresencaQtdWrapper = document.getElementById("q10-sensor-presenca-qtd-wrapper");
const q10SensorBarreira = document.getElementById("q10-sensor-barreira");
const q10SensorBarreiraQtd = document.getElementById("q10-sensor-barreira-qtd");
const q10SensorBarreiraQtdWrapper = document.getElementById("q10-sensor-barreira-qtd-wrapper");
const q9Observacoes = document.getElementById("q9-observacoes");
const q10Observacoes = document.getElementById("q10-observacoes");

// Quantitativo 10 – Novos campos (Expansão)
// Eletroímã/Fechadura
const q10EletroimãFechadura = document.getElementById("q10-eletroimã-fechadura");
const q10EletroimãFechaduraModelo = document.getElementById("q10-eletroimã-fechadura-modelo");
const q10EletroimãFechaduraModeloWrapper = document.getElementById("q10-eletroimã-fechadura-modelo-wrapper");
const q10EletroimãFechaduraQtd = document.getElementById("q10-eletroimã-fechadura-qtd");
const q10EletroimãFechaduraQtdWrapper = document.getElementById("q10-eletroimã-fechadura-qtd-wrapper");

// Mola Hidráulica
const q10MolaHidraulica = document.getElementById("q10-mola-hidraulica");
const q10MolaHidraulicaTipo = document.getElementById("q10-mola-hidraulica-tipo");
const q10MolaHidraulicaTipoWrapper = document.getElementById("q10-mola-hidraulica-tipo-wrapper");
const q10MolaHidraulicaQtd = document.getElementById("q10-mola-hidraulica-qtd");
const q10MolaHidraulicaQtdWrapper = document.getElementById("q10-mola-hidraulica-qtd-wrapper");

// Proteção Botoeira Emergência
const q10ProtecaoBotoeiraEmergenciaQtd = document.getElementById("q10-protecao-botoeira-emergencia-qtd");

// Modelos dos campos Q10 existentes
const q10BotoeiraSaidaModelo = document.getElementById("q10-botoeira-saida-modelo");
const q10BotoeiraSaidaModeloWrapper = document.getElementById("q10-botoeira-saida-modelo-wrapper");
const q10BotoeiraEmergenciaModelo = document.getElementById("q10-botoeira-emergencia-modelo");
const q10BotoeiraEmergenciaModeloWrapper = document.getElementById("q10-botoeira-emergencia-modelo-wrapper");
const q10LeitorCartaoModelo = document.getElementById("q10-leitor-cartao-modelo");
const q10LeitorCartaoModeloWrapper = document.getElementById("q10-leitor-cartao-modelo-wrapper");
const q10LeitorFacialModelo = document.getElementById("q10-leitor-facial-modelo");
const q10LeitorFacialModeloWrapper = document.getElementById("q10-leitor-facial-modelo-wrapper");
const q10SensorPresencaModelo = document.getElementById("q10-sensor-presenca-modelo");
const q10SensorPresencaModeloWrapper = document.getElementById("q10-sensor-presenca-modelo-wrapper");
const q10SensorBarreiraModelo = document.getElementById("q10-sensor-barreira-modelo");
const q10SensorBarreiraModeloWrapper = document.getElementById("q10-sensor-barreira-modelo-wrapper");

// Quantitativo 06 – Catracas, Torniquetes e Cancelas
const q6Modelo = document.getElementById("q6-modelo");
const q6Quantidade = document.getElementById("q6-quantidade");
const q6LeitorFacial = document.getElementById("q6-leitor-facial");
const q6LeitorFacialQtd = document.getElementById("q6-leitor-facial-qtd");
const q6LeitorFacialQtdWrapper = document.getElementById("q6-leitor-facial-qtd-wrapper");
const q6SuporteLeitorFacial = document.getElementById("q6-suporte-leitor-facial");
const q6SuporteLeitorFacialQtd = document.getElementById("q6-suporte-leitor-facial-qtd");
const q6SuporteLeitorFacialQtdWrapper = document.getElementById("q6-suporte-leitor-facial-qtd-wrapper");
const q6LeitorCartao = document.getElementById("q6-leitor-cartao");
const q6LeitorCartaoQtd = document.getElementById("q6-leitor-cartao-qtd");
const q6LeitorCartaoQtdWrapper = document.getElementById("q6-leitor-cartao-qtd-wrapper");
const q6SuporteLeitorCartao = document.getElementById("q6-suporte-leitor-cartao");
const q6SuporteLeitorCartaoQtd = document.getElementById("q6-suporte-leitor-cartao-qtd");
const q6SuporteLeitorCartaoQtdWrapper = document.getElementById("q6-suporte-leitor-cartao-qtd-wrapper");
const q6LicencaSoftware = document.getElementById("q6-licenca-software");
const q6NoBreak = document.getElementById("q6-no-break");
const q6Servidor = document.getElementById("q6-servidor");
const q6Observacoes = document.getElementById("q6-observacoes");

// Quantitativo 06 – Expansão de campos
// No-break
const q6NoBreakModelo = document.getElementById("q6-no-break-modelo");
const q6NoBreakQtd = document.getElementById("q6-no-break-qtd");

// Servidor
const q6ServidorModelo = document.getElementById("q6-servidor-modelo");
const q6ServidorQtd = document.getElementById("q6-servidor-qtd");

// ----------------------------- // bloco de constantes específico da lista de materiais de infraestrutura
// Lista de materiais – Infraestrutura
// ----------------------------- // comentário visual separando a seção de lista de materiais das demais constantes

const infraListaMateriaisTabela = document.getElementById("infra-lista-materiais-tabela"); // obtém a referência para a tabela da lista de materiais de infraestrutura
const infraListaMateriaisTbody = document.getElementById("infra-lista-materiais-tbody");   // obtém o corpo da tabela onde as linhas de materiais serão inseridas/removidas
const infraAdicionarLinhaButton = document.getElementById("btn-infra-adicionar-linha");    // obtém o botão responsável por adicionar uma nova linha na lista de materiais

// Imagens
const imgRef1 = document.getElementById("localizacao-imagem1-url");
const imgRef2 = document.getElementById("localizacao-imagem2-url");

// Pré-requisitos
const preTrabalhoAltura = document.getElementById("pre-trabalho-altura");
const prePlataforma = document.getElementById("pre-plataforma");
const prePlataformaModelo = document.getElementById("pre-plataforma-modelo");
const prePlataformaDias = document.getElementById("pre-plataforma-dias");
const preForaHorario = document.getElementById("pre-fora-horario-comercial");
const preVeiculoEmpresa = document.getElementById("pre-veiculo-quotation_evaluation");
const preContainer = document.getElementById("pre-container-materiais");

// Horas trabalhadas - Tabela 4 (dias normais)
const encarregadoDiasInput = document.getElementById("encarregado-dias");                 // input com a quantidade de dias do encarregado
const instaladorDiasInput = document.getElementById("instalador-dias");                   // input com a quantidade de dias do instalador
const auxiliarDiasInput = document.getElementById("auxiliar-dias");                       // input com a quantidade de dias do auxiliar
const tecnicoInstalacaoDiasInput = document.getElementById("tecnico-de-instalacao-dias"); // input com dias do técnico de instalação
const tecnicoSegurancaDiasInput = document.getElementById("tecnico-em-seguranca-dias");   // input com dias do técnico em segurança eletrônica

// Horas extras por função
const encarregadoHoraExtraInput = document.getElementById("encarregado-hora-extra");                 // input com horas extras do encarregado
const instaladorHoraExtraInput = document.getElementById("instalador-hora-extra");                   // input com horas extras do instalador
const auxiliarHoraExtraInput = document.getElementById("auxiliar-hora-extra");                       // input com horas extras do auxiliar
const tecnicoInstalacaoHoraExtraInput = document.getElementById("tecnico-de-instalacao-hora-extra"); // input com horas extras do técnico de instalação
const tecnicoSegurancaHoraExtraInput = document.getElementById("tecnico-em-seguranca-hora-extra");   // input com horas extras do técnico em segurança

// Trabalho em domingos/feriados por função
const encarregadoDomingoInput = document.getElementById("encarregado-trabalho-domingo");                 // domingos/feriados trabalhados pelo encarregado
const instaladorDomingoInput = document.getElementById("instalador-trabalho-domingo");                   // domingos/feriados trabalhados pelo instalador
const auxiliarDomingoInput = document.getElementById("auxiliar-trabalho-domingo");                       // domingos/feriados trabalhados pelo auxiliar
const tecnicoInstalacaoDomingoInput = document.getElementById("tecnico-de-instalacao-trabalho-domingo"); // domingos/feriados do técnico de instalação
const tecnicoSegurancaDomingoInput = document.getElementById("tecnico-em-seguranca-trabalho-domingo");   // domingos/feriados do técnico em segurança

// Prazos (cronograma e entregas)
const cronogramaExecucaoSelect = document.getElementById("cronograma-execucao");           // select de Sim/Não para cronograma de execução
const diasInstalacaoInput = document.getElementById("dias-instalacao");                    // input de dias previstos de instalação
const asBuiltSelect = document.getElementById("as-built");                                 // select de Sim/Não para As Built
const diasEntregaRelatorioInput = document.getElementById("dias-entrega-relatorio");       // input de dias para entrega do relatório
const artSelect = document.getElementById("art");                                          // select de Sim/Não para ART

// Alimentação / refeições
const almocoQtdInput = document.getElementById("almoco-qtd");   // input com quantidade estimada de almoços
const lancheQtdInput = document.getElementById("lanche-qtd");   // input com quantidade estimada de lanches

const avaliacaoFeedbackEl = document.getElementById("avaliacao-feedback"); // parágrafo para mensagens de feedback
const salvarAvaliacaoButton = document.getElementById("btn-salvar-avaliacao"); // referência ao botão "Salvar Avaliação"
const salvarRascunhoButton = document.getElementById("btn-salvar-rascunho"); // referência ao botão "Salvar rascunho" (salvamento local)
// Botão para limpar o formulário e voltar explicitamente ao modo "Nova Avaliação".
const novaAvaliacaoButton = document.getElementById("btn-nova-avaliacao"); // referência ao botão "Nova avaliação"
const btnGerarListaMateriais = document.getElementById("btn-gerar-lista-materiais");
const btnExportarPDF = document.getElementById("btn-exportar-pdf");
// Exibe ou esconde o botão de gerar lista de materiais conforme permissão e contexto

function atualizarVisibilidadeBotaoGerarLista() {
  if (!btnGerarListaMateriais) return;
  if (isAdminOrComercial() || isVisualizador()) {
    btnGerarListaMateriais.style.display = "inline-block";
  } else {
    btnGerarListaMateriais.style.display = "none";
  }
}

function atualizarVisibilidadeBotaoExportarPDF() {
  if (!btnExportarPDF) return;
  if (isAdminOrComercial() || isVisualizador()) {
    btnExportarPDF.style.display = "inline-block";
    // Habilita ou desabilita conforme avaliação registrada
    if (
      avaliacaoEmEdicaoId !== null &&
      avaliacaoEmEdicaoCodigo !== null &&
      typeof avaliacaoEmEdicaoCodigo === "string" &&
      avaliacaoEmEdicaoCodigo.trim() !== ""
    ) {
      btnExportarPDF.disabled = false;
      btnExportarPDF.title = "Exportar avaliação para PDF";
    } else {
      btnExportarPDF.disabled = true;
      btnExportarPDF.title = "Selecione uma avaliação antes de exportar";
    }
  } else {
    btnExportarPDF.style.display = "none";
  }
}

// Função utilitária: retorna um objeto com todos os campos preenchidos da avaliação atualmente selecionada
function coletarCamposPreenchidosAvaliacao() {
  if (!formAvaliacao) return null;
  const campos = formAvaliacao.querySelectorAll("input, select, textarea");
  const preenchidos = {};
  
  // Mapeamento de IDs para labels legíveis
  const labelsMap = {
    "cliente-nome": "Cliente",
    "cliente-nome-outro": "Cliente (Outro)",
    "data-avaliacao": "Data da avaliação",
    "local": "Local",
    "objeto": "Objeto",
    "status": "Status",
    "equipe": "Equipe responsável",
    "responsavel-avaliacao": "Responsável técnico",
    "contato-cliente": "Nome do solicitante",
    "email-cliente": "E-mail do cliente",
    "escopo-texto": "Escopo / Observações",
    "pedido-compra": "Pedido de compra",
    "numero-proposta": "Número da proposta",
    "servico-fora-montes-claros": "Serviço fora de Montes Claros",
    "servico-intermediario": "Serviço intermediário/empreiteira",
    "q1-categoria-cab": "Categoria do cabeamento",
    "q1-blindado": "Cabeamento blindado",
    "q1-novo-patch-panel": "Necessita novo patch panel",
    "q1-incluir-guia": "Incluir guia de cabos",
    "q1-qtd-guias-cabos": "Quantidade de guias de cabos",
    "q1-qtd-pontos-rede": "Quantidade de pontos de rede",
    "q1-qtd-cabos": "Quantidade de cabos",
    "q1-qtd-portas-patch-panel": "Quantidade de portas no patch panel",
    "q1-qtd-patch-cords": "Quantidade de patch cords",
    "q1-modelo-patch-panel": "Modelo do patch panel",
    "q1-modelo-patch-panel-outro": "Modelo do patch panel (Outro)",
    "q1-marca-cab": "Marca do cabeamento",
    "q1-marca-cab-outro": "Marca do cabeamento (Outro)",
    "q1-patch-cords-modelo": "Modelo dos patch cords",
    "q1-patch-cords-cor": "Cor dos patch cords",
    "q1-patch-panel-existente-nome": "Identificação do patch panel existente",
    "q2-novo-switch": "Necessita novo switch",
    "q2-fornecedor-switch": "Fornecedor do switch",
    "q2-modelo-switch": "Modelo do switch",
    "q2-switch-foto-url": "URL da foto do switch",
    "q2-observacoes": "Observações sobre switches",
    "q3-tipo-fibra": "Tipo de fibra",
    "q3-qtd-fibras-por-cabo": "Fibras por cabo",
    "q3-tipo-conector": "Tipo de conector",
    "q3-modelo-dio": "Modelo do DIO",
    "q3-novo-dio": "Necessário novo DIO",
    "q3-caixa-terminacao": "Caixa de terminação",
    "q3-caixa-emenda": "Caixa de emenda",
    "q3-qtd-cabos": "Quantidade de cabos ópticos",
    "q3-tamanho-total-m": "Metragem total",
    "q3-qtd-cordoes-opticos": "Quantidade de cordões ópticos",
    "q3-marca-cab-optico": "Marca do cabo óptico",
    "q3-marca-cab-opt-outro": "Marca do cabo óptico (Outro)",
    "q3-modelo-cordao-optico": "Modelo do cordão óptico",
    "q3-observacoes": "Observações sobre fibra óptica",
    "q4-camera": "Câmera",
    "q4-nvr-dvr": "NVR/DVR",
    "q4-camera-nova": "Câmera nova/realocação",
    "q4-camera-fornecedor": "Fornecedor da câmera",
    "q4-camera-modelo": "Modelo da câmera",
    "q4-camera-qtd": "Quantidade de câmeras",
    "q4-nvr-dvr-modelo": "Modelo do NVR/DVR",
    "q5-nova-eletrocalha": "Nova eletrocalha",
    "q5-novo-eletroduto": "Novo eletroduto",
    "q5-novo-rack": "Novo rack",
    "q5-instalacao-eletrica": "Instalação elétrica",
    "q5-nobreak": "Nobreak",
    "q5-serralheria": "Serralheria",
    "q5-eletrocalha-modelo": "Modelo da eletrocalha",
    "q5-eletrocalha-qtd": "Quantidade de eletrocalhas",
    "q5-eletroduto-modelo": "Modelo do eletroduto",
    "q5-eletroduto-qtd": "Quantidade de eletrodutos",
    "q5-rack-modelo": "Modelo do rack",
    "q5-rack-qtd": "Quantidade de racks",
    "q5-nobreak-modelo": "Modelo do nobreak",
    "q5-nobreak-qtd": "Quantidade de nobreaks",
    "q5-serralheria-descricao": "Descrição da serralheria",
    "q5-instalacao-eletrica-obs": "Observações da instalação elétrica",
    "pre-trabalho-altura": "Trabalho em altura",
    "pre-plataforma": "Plataforma",
    "pre-plataforma-modelo": "Modelo da plataforma",
    "pre-plataforma-dias": "Dias de plataforma",
    "pre-fora-horario-comercial": "Fora do horário comercial",
    "pre-veiculo-quotation_evaluation": "Veículo Technical Quotation Evaluation",
    "pre-container-materiais": "Container de materiais",
    "encarregado-dias": "Dias - Encarregado",
    "instalador-dias": "Dias - Instalador",
    "auxiliar-dias": "Dias - Auxiliar",
    "tecnico-de-instalacao-dias": "Dias - Técnico de instalação",
    "tecnico-em-seguranca-dias": "Dias - Técnico em segurança",
    "encarregado-hora-extra": "Horas extras - Encarregado",
    "instalador-hora-extra": "Horas extras - Instalador",
    "auxiliar-hora-extra": "Horas extras - Auxiliar",
    "tecnico-de-instalacao-hora-extra": "Horas extras - Técnico de instalação",
    "tecnico-em-seguranca-hora-extra": "Horas extras - Técnico em segurança",
    "encarregado-trabalho-domingo": "Domingos/feriados - Encarregado",
    "instalador-trabalho-domingo": "Domingos/feriados - Instalador",
    "auxiliar-trabalho-domingo": "Domingos/feriados - Auxiliar",
    "tecnico-de-instalacao-trabalho-domingo": "Domingos/feriados - Técnico de instalação",
    "tecnico-em-seguranca-trabalho-domingo": "Domingos/feriados - Técnico em segurança",
    "cronograma-execucao": "Cronograma de execução",
    "dias-instalacao": "Dias de instalação",
    "as-built": "As Built",
    "dias-entrega-relatorio": "Prazo de entrega do relatório",
    "art": "ART",
    "almoco-qtd": "Quantidade de almoços",
    "lanche-qtd": "Quantidade de lanches"
  };
  
  campos.forEach((campo) => {
    if (!campo.id) return;
    let valor = campo.value;
    if (campo.type === "checkbox") valor = campo.checked;
    if (typeof valor === "string" && valor.trim() === "") return;
    if (typeof valor === "undefined" || valor === null) return;
    // Omitir campos ocultos (ex: hidden, ou display: none)
    if (campo.type === "hidden" || campo.offsetParent === null) return;

    // Omitir campos de descrição das galerias (serão exibidos apenas acima das fotos)
    if (/(?:-descricao|_descricao|descricao)$/i.test(campo.id)) return;

    // Usar o label mapeado ou o ID como fallback
    const label = labelsMap[campo.id] || campo.id;
    if(label == "Status"){
      preenchidos[label] = formatarStatusExibicao(valor);
    }
    else{
      preenchidos[label] = valor;
    }
  });
  return preenchidos;
}

// Função para exportar avaliação preenchida em PDF
function exportarAvaliacaoParaPDF() {
  try {
    const { jsPDF } = window.jspdf;
    if (!jsPDF) {
      throw new Error("Biblioteca jsPDF não está carregada.");
    }

    const doc = new jsPDF();
    const campos = coletarCamposPreenchidosAvaliacao();
    if (!campos || Object.keys(campos).length === 0) {
      if (avaliacaoFeedbackEl) {
        avaliacaoFeedbackEl.textContent = "Nenhum campo preenchido para exportar.";
        avaliacaoFeedbackEl.className = "form-feedback form-error";
      }
      return;
    }

    // Configuração de cores Technical Quotation Evaluation (reutiliza estilo da lista de materiais)
    const azulPrimario = [29, 78, 216]; // #1d4ed8

    // Logo Technical Quotation Evaluation (usar o mesmo ícone que gera a lista de materiais)
    const logoUrl = window.location.origin + "/static/icons/application-icon-180.png";

    // Função para adicionar logo e conteúdo após carregar a imagem (igual a gerarPDFListaMateriais)
    const addLogoAndContent = (logoDataUrl) => {
      // Fundo azul para área de logo/título (mesma estética)
      doc.setFillColor(...azulPrimario);
      doc.rect(0, 15, 210, 20, 'F'); // Fundo azul

      // Alinha a logo à esquerda do título (mesmas dimensões usadas na lista de materiais)
      const logoWidth = 22;
      const logoHeight = 22;
      const logoX = 25;
      const logoY = 38;
      doc.addImage(logoDataUrl, 'PNG', logoX, logoY, logoWidth, logoHeight);

      // Centraliza verticalmente o título e o código em relação ao centro da logo
      const logoCenterY = logoY + logoHeight / 2;
      const titleFontSize = 16;
      const codeFontSize = 10;

      doc.setTextColor(...azulPrimario);
      doc.setFontSize(titleFontSize);
      doc.setFont("helvetica", "bold");
      // Ajuste fino: desloca levemente para baixo para alinhar melhor visualmente
      const titleY = logoCenterY + 3;
      doc.text("Avaliação Técnica - Dados Preenchidos", logoX + logoWidth + 8, titleY, { align: "left" });

      doc.setFontSize(codeFontSize);
      doc.setFont("helvetica", "normal");
      const codeY = titleY + 8;
      doc.text(`Código da Avaliação: ${avaliacaoEmEdicaoCodigo || "-"}`, logoX + logoWidth + 8, codeY, { align: "left" });

      // Objeto da avaliação (se existir)
      const objetoValor = objetoInput ? objetoInput.value : "";
      if (objetoValor && objetoValor.trim() !== "") {
        doc.setFontSize(12);
        doc.setTextColor(0, 0, 0);
        doc.text(`Objeto: ${objetoValor}`, 14, logoY + logoHeight + 6);
      }

      // Monta tabela de campos preenchidos (exclui Objeto porque já foi mostrado)
      const rows = [];
      for (const [campo, valor] of Object.entries(campos)) {
        if (campo === "Objeto") continue;
        rows.push([campo, String(valor)]);
      }

      // Verifica se autoTable está disponível
      if (typeof doc.autoTable !== 'function') {
        throw new Error("Plugin jsPDF-AutoTable não está carregado.");
      }

      // Começa a tabela um pouco mais abaixo (similar à lista de materiais)
      const startY = 70;
      doc.autoTable({
        head: [["Campo", "Descrição"]],
        body: rows,
        startY: startY,
        styles: { fontSize: 9 },
        headStyles: { fillColor: azulPrimario },
        margin: { left: 14, right: 14 }
      });

      // Depois da tabela, incluímos as imagens anexadas (se houver)
      (async function appendImagesAndSave() {
        // coleta linhas de imagens de seções conhecidas separadamente
        let localImgs = [];
        let q2Imgs = [];
        if (window.localizacaoImagens && typeof window.localizacaoImagens.getLinhas === 'function') {
          localImgs = (window.localizacaoImagens.getLinhas() || []).filter(l => l && l.url && String(l.url).trim() !== "");
        }
        if (window.q2SwitchImagens && typeof window.q2SwitchImagens.getLinhas === 'function') {
          q2Imgs = (window.q2SwitchImagens.getLinhas() || []).filter(l => l && l.url && String(l.url).trim() !== "");
        }

        // helper: converte url (data: ou http) para dataURL
        async function urlToDataUrl(u) {
          if (!u) return null;
          if (String(u).startsWith('data:')) return u;
          try {
            const resp = await fetch(u);
            const blob = await resp.blob();
            return await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          } catch (err) {
            console.warn('Falha ao converter imagem para dataURL:', err);
            return null;
          }
        }

        // posição inicial após a tabela
        let currentY = doc.lastAutoTable && doc.lastAutoTable.finalY ? doc.lastAutoTable.finalY + 8 : startY + 40;

        // helper para inserir um array de imagens (mantém currentY e respeita quebras)
        async function inserirArrayImagens(arr) {
          for (const linha of arr) {
            const dataUrl = await urlToDataUrl(linha.url);
            if (!dataUrl) continue;
            await new Promise((resolve) => {
              const img = new Image();
              img.onload = function() {
                const maxWidth = 170;
                const displayWidth = Math.min(maxWidth, img.width > img.height ? 120 : 80);
                const ratio = img.height / img.width;
                const displayHeight = displayWidth * ratio;
                if (currentY + displayHeight + 20 > 280) {
                  doc.addPage();
                  currentY = 20;
                }
                const tituloCard = linha.titulo || linha.title || linha.rotulo || null;
                if (tituloCard) {
                  doc.setFontSize(11);
                  doc.setFont("helvetica", "bold");
                  doc.setTextColor(0,0,0);
                  doc.text(String(tituloCard), 14, currentY);
                  currentY += 6;
                }
                if (linha.descricao) {
                  doc.setFontSize(10);
                  doc.setFont("helvetica", "normal");
                  doc.setTextColor(0,0,0);
                  doc.text(String(linha.descricao), 14, currentY);
                  currentY += 10;
                }
                const lower = dataUrl.substring(5, 15).toLowerCase();
                const format = lower.includes('jpeg') || lower.includes('jpg') ? 'JPEG' : 'PNG';
                doc.addImage(dataUrl, format, 14, currentY, displayWidth, displayHeight);
                currentY += displayHeight + 8;
                resolve();
              };
              img.onerror = function() { resolve(); };
              img.src = dataUrl;
            });
          }
        }

        // Insere imagens na ordem em que os containers aparecem no formulário
        const formNodes = formAvaliacao ? Array.from(formAvaliacao.querySelectorAll('*')) : [];
        for (const node of formNodes) {
          if (node.id === 'q2-switch-imagens-rows' && q2Imgs.length > 0) {
            await inserirArrayImagens(q2Imgs);
            q2Imgs = [];
          }
          if (node.id === 'localizacao-imagens-section' && localImgs.length > 0) {
            await inserirArrayImagens(localImgs);
            localImgs = [];
          }
        }

        // se restarem imagens sem lugar (legacy), adiciona ao final
        if (q2Imgs.length > 0) await inserirArrayImagens(q2Imgs);
        if (localImgs.length > 0) await inserirArrayImagens(localImgs);

        // salva somente depois de inserir imagens
        doc.save(`Avaliacao_${avaliacaoEmEdicaoCodigo || "sem_codigo"}.pdf`);
        if (avaliacaoFeedbackEl) {
          avaliacaoFeedbackEl.textContent = "PDF da avaliação exportado com sucesso!";
          avaliacaoFeedbackEl.className = "form-feedback form-success";
        }
      })();
    };

    // Carrega a logo como base64 (fetch -> blob -> FileReader) e chama addLogoAndContent
    fetch(logoUrl)
      .then(response => response.blob())
      .then(blob => {
        const reader = new FileReader();
        reader.onload = function (e) {
          addLogoAndContent(e.target.result);
        };
        reader.readAsDataURL(blob);
      })
      .catch(error => {
        console.warn("Erro ao carregar logo, gerando PDF sem logo:", error);
        // Fallback: gerar PDF sem logo mantendo mesmo layout de títulos
        doc.setFontSize(16);
        doc.text("Avaliação Técnica - Dados Preenchidos", 14, 18);
        doc.setFontSize(10);
        doc.text(`Código da Avaliação: ${avaliacaoEmEdicaoCodigo || "-"}` , 14, 26);

        const objetoValor = objetoInput ? objetoInput.value : "";
        if (objetoValor && objetoValor.trim() !== "") {
          doc.setFontSize(12);
          doc.text(`Objeto: ${objetoValor}`, 14, 40);
        }

        const rows = [];
        for (const [campo, valor] of Object.entries(campos)) {
          if (campo === "Objeto") continue;
          rows.push([campo, String(valor)]);
        }

        if (typeof doc.autoTable !== 'function') {
          throw new Error("Plugin jsPDF-AutoTable não está carregado.");
        }

        const startY = objetoValor && objetoValor.trim() !== "" ? 50 : 40;
        doc.autoTable({
          head: [["Campo", "Descrição"]],
          body: rows,
          startY: startY,
          styles: { fontSize: 9 },
          headStyles: { fillColor: azulPrimario },
          margin: { left: 14, right: 14 }
        });

        // mesmo fluxo de anexar imagens e salvar (reutiliza lógica async)
        (async function appendImagesAndSaveFallback() {
          // coleta separadamente por seção
          let localImgs = [];
          let q2Imgs = [];
          if (window.localizacaoImagens && typeof window.localizacaoImagens.getLinhas === 'function') {
            localImgs = (window.localizacaoImagens.getLinhas() || []).filter(l => l && l.url && String(l.url).trim() !== "");
          }
          if (window.q2SwitchImagens && typeof window.q2SwitchImagens.getLinhas === 'function') {
            q2Imgs = (window.q2SwitchImagens.getLinhas() || []).filter(l => l && l.url && String(l.url).trim() !== "");
          }

          async function urlToDataUrl(u) {
            if (!u) return null;
            if (String(u).startsWith('data:')) return u;
            try {
              const resp = await fetch(u);
              const blob = await resp.blob();
              return await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
              });
            } catch (err) {
              console.warn('Falha ao converter imagem para dataURL:', err);
              return null;
            }
          }

          let currentY = doc.lastAutoTable && doc.lastAutoTable.finalY ? doc.lastAutoTable.finalY + 8 : startY + 40;

          async function inserirArrayImagens(arr) {
            for (const linha of arr) {
              const dataUrl = await urlToDataUrl(linha.url);
              if (!dataUrl) continue;
              await new Promise((resolve) => {
                const img = new Image();
                img.onload = function() {
                  const maxWidth = 170;
                  const displayWidth = Math.min(maxWidth, img.width > img.height ? 120 : 80);
                  const ratio = img.height / img.width;
                  const displayHeight = displayWidth * ratio;
                  if (currentY + displayHeight + 20 > 280) {
                    doc.addPage();
                    currentY = 20;
                  }
                  const tituloCard = linha.titulo || linha.title || linha.rotulo || null;
                  if (tituloCard) {
                    doc.setFontSize(11);
                    doc.setFont("helvetica", "bold");
                    doc.setTextColor(0,0,0);
                    doc.text(String(tituloCard), 14, currentY);
                    currentY += 6;
                  }
                  if (linha.descricao) {
                    doc.setFontSize(10);
                    doc.setFont("helvetica", "normal");
                    doc.setTextColor(0,0,0);
                    doc.text(String(linha.descricao), 14, currentY);
                    currentY += 10;
                  }
                  const lower = dataUrl.substring(5, 15).toLowerCase();
                  const format = lower.includes('jpeg') || lower.includes('jpg') ? 'JPEG' : 'PNG';
                  doc.addImage(dataUrl, format, 14, currentY, displayWidth, displayHeight);
                  currentY += displayHeight + 8;
                  resolve();
                };
                img.onerror = function() { resolve(); };
                img.src = dataUrl;
              });
            }
          }

          // Insere conforme ordem do formulário
          const formNodes = formAvaliacao ? Array.from(formAvaliacao.querySelectorAll('*')) : [];
          for (const node of formNodes) {
            if (node.id === 'q2-switch-imagens-rows' && q2Imgs.length > 0) {
              await inserirArrayImagens(q2Imgs);
              q2Imgs = [];
            }
            if (node.id === 'localizacao-imagens-section' && localImgs.length > 0) {
              await inserirArrayImagens(localImgs);
              localImgs = [];
            }
          }
          if (q2Imgs.length > 0) await inserirArrayImagens(q2Imgs);
          if (localImgs.length > 0) await inserirArrayImagens(localImgs);

          doc.save(`Avaliacao_${avaliacaoEmEdicaoCodigo || "sem_codigo"}.pdf`);
          if (avaliacaoFeedbackEl) {
            avaliacaoFeedbackEl.textContent = "PDF da avaliação exportado com sucesso!";
            avaliacaoFeedbackEl.className = "form-feedback form-success";
          }
        })();
      });
    
  } catch (error) {
    console.error("Erro ao exportar PDF:", error);
    if (avaliacaoFeedbackEl) {
      avaliacaoFeedbackEl.textContent = `Erro ao exportar PDF: ${error.message}`;
      avaliacaoFeedbackEl.className = "form-feedback form-error";
    }
  }
}

// Handler do botão Exportar PDF
if (btnExportarPDF) {
  btnExportarPDF.addEventListener("click", function () {
    // Só permite se for admin/comercial ou visualizador
    if (!(isAdminOrComercial() || isVisualizador())) {
      if (avaliacaoFeedbackEl) {
        avaliacaoFeedbackEl.textContent = "Apenas Administrador, Comercial ou Visualizador podem exportar PDF de avaliações.";
        avaliacaoFeedbackEl.className = "form-feedback form-error";
      }
      return;
    }
    // Se não houver avaliação registrada selecionada
    if (
      avaliacaoEmEdicaoId === null ||
      avaliacaoEmEdicaoCodigo === null ||
      typeof avaliacaoEmEdicaoCodigo !== "string" ||
      avaliacaoEmEdicaoCodigo.trim() === ""
    ) {
      if (avaliacaoFeedbackEl) {
        avaliacaoFeedbackEl.textContent = "Selecione uma avaliação registrada para exportar o PDF.";
        avaliacaoFeedbackEl.className = "form-feedback form-error";
      }
      return;
    }
  });
}
// Chama ao carregar a tela de avaliação ou ao trocar usuário

if (btnGerarListaMateriais) {
  atualizarVisibilidadeBotaoGerarLista();
}
if (btnExportarPDF) {
  atualizarVisibilidadeBotaoExportarPDF();
}

// Handler do botão de gerar lista de materiais
if (btnGerarListaMateriais) {
  btnGerarListaMateriais.addEventListener("click", function () {
    // Só permite se for admin/comercial ou visualizador
    if (!(isAdminOrComercial() || isVisualizador())) {
      if (avaliacaoFeedbackEl) {
        avaliacaoFeedbackEl.textContent = "Apenas Administrador, Comercial ou Visualizador podem gerar a lista de materiais.";
        avaliacaoFeedbackEl.className = "form-feedback form-error";
      }
      return;
    }
    // Verifica se o campo Pedido de Compra está preenchido
    const pedidoCompraInput = document.getElementById("pedido-compra");
    const pedidoCompra = pedidoCompraInput ? pedidoCompraInput.value.trim() : "";
    if (!pedidoCompra) {
      if (avaliacaoFeedbackEl) {
        avaliacaoFeedbackEl.textContent = "Preencha o campo 'Pedido de Compra' para gerar a lista de materiais.";
        avaliacaoFeedbackEl.className = "form-feedback form-error";
      }
      return;
    }
    // Lógica de geração do PDF
    try {
      gerarPDFListaMateriais(pedidoCompra);
      if (avaliacaoFeedbackEl) {
        avaliacaoFeedbackEl.textContent = "PDF da lista de materiais gerado com sucesso!";
        avaliacaoFeedbackEl.className = "form-feedback form-success";
      }
    } catch (error) {
      console.error("Erro ao gerar PDF:", error);
      if (avaliacaoFeedbackEl) {
        avaliacaoFeedbackEl.textContent = "Erro ao gerar o PDF. Verifique se há materiais na lista.";
        avaliacaoFeedbackEl.className = "form-feedback form-error";
      }
    }
  });
}

/**
 * Gera o PDF da lista de materiais no formato do modelo Technical Quotation Evaluation
 * @param {string} pedidoCompra - Número do pedido de compra
 */
function gerarPDFListaMateriais(pedidoCompra) {
  // Instancia o jsPDF
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  // Coleta os dados da lista de materiais
  const linhas = document.querySelectorAll(".infra-lista-materiais-linha");
  const materiais = [];

  linhas.forEach((linha) => {
    const equipamento = linha.querySelector(".infra-lista-materiais-equipamento")?.value.trim() || "";
    const modelo = linha.querySelector(".infra-lista-materiais-modelo")?.value.trim() || "";
    const quantidade = linha.querySelector(".infra-lista-materiais-quantidade")?.value.trim() || "";
    const fabricante = linha.querySelector(".infra-lista-materiais-fabricante")?.value.trim() || "";

    // Só adiciona se tiver pelo menos equipamento ou quantidade
    if (equipamento || quantidade) {
      let descricao = equipamento;
      if (modelo) descricao += " " + modelo;
      if (fabricante) descricao += " - " + fabricante;

      materiais.push({
        quantidade: quantidade || "-",
        descricao: descricao || "-"
      });
    }
  });

  if (materiais.length === 0) {
    throw new Error("Nenhum material encontrado na lista");
  }

  // Configurações de cores Technical Quotation Evaluation
  const azulPrimario = [29, 78, 216]; // #1d4ed8
  const vermelho = [220, 38, 38]; // #dc2626

  // Lista de palavras-chave que devem aparecer em vermelho
  const palavrasVermelhas = ["conduite corrugado", "condulete", "unidute cônico", "tampa condulete"];

  // ========== CABEÇALHO AZUL ==========
  doc.setFillColor(...azulPrimario);
  doc.rect(0, 0, 210, 15, 'F'); // Retângulo azul no topo

  doc.setTextColor(255, 255, 255); // Texto branco
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("*Sempre confirmar lista de materiais antes de iniciar execução*", 105, 9, { align: "center" });

  // ========== LOGO E TÍTULO ==========
  doc.setFillColor(...azulPrimario);
  doc.rect(0, 15, 210, 20, 'F'); // Fundo azul para logo e título

  // Logo Technical Quotation Evaluation (imagem PNG, lado esquerdo)
  // Caminho relativo ao projeto (ajuste se necessário)
  const logoUrl = window.location.origin + "/static/icons/application-icon-180.png";
  // Adiciona a logo (tamanho 18x18mm, posição x=15mm, y=18mm)
  // jsPDF suporta addImage com base64 ou URL (em browsers modernos)
  // Usar callback para garantir carregamento
  const addLogoAndTitle = (logoDataUrl) => {
    // Alinha a logo à esquerda do título
    const logoWidth = 22;
    const logoHeight = 22;
    const logoX = 25;
    const logoY = 38;
    doc.addImage(logoDataUrl, 'PNG', logoX, logoY, logoWidth, logoHeight);

    // Título do documento alinhado à esquerda da logo
    doc.setTextColor(29, 78, 216); // azul Technical Quotation Evaluation
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    // O texto começa um pouco à direita da logo
    doc.text(`Lista de Materiais – ${pedidoCompra}`, logoX + logoWidth + 8, logoY + 15, { align: "left" });

    desenharTabela(70); // Começa a tabela mais abaixo
    doc.save(`Lista_Materiais_${pedidoCompra}.pdf`);
  };

  // Função para desenhar a tabela e centralizar textos
  function desenharTabela() {
    // ========== CABEÇALHO DA TABELA ==========
    let y = arguments[0] || 70;
    doc.setFillColor(...azulPrimario);
    doc.setDrawColor(...azulPrimario); // borda azul igual à logo
    doc.rect(10, y, 50, 12, 'FD'); // Quantidade
    doc.rect(60, y, 140, 12, 'FD'); // Materiais
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Quantidade", 35, y + 8, { align: "center" });
    doc.text("Materiais/Equipamentos", 130, y + 8, { align: "center" });

    // ========== LINHAS DA TABELA ==========
    y += 12;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setDrawColor(0, 0, 0); // borda preta para linhas
    materiais.forEach((material, index) => {
      // Verifica se precisa criar nova página
      if (y > 270) {
        doc.addPage();
        y = 20;
        doc.setFillColor(...azulPrimario);
        doc.setDrawColor(...azulPrimario);
        doc.rect(10, y, 50, 12, 'FD');
        doc.rect(60, y, 140, 12, 'FD');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text("Quantidade", 35, y + 8, { align: "center" });
        doc.text("Materiais/Equipamentos", 130, y + 8, { align: "center" });
        y += 12;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setDrawColor(0, 0, 0);
      }
      // Verifica se deve colorir de vermelho
      const deveSerVermelho = palavrasVermelhas.some(palavra =>
        material.descricao.toLowerCase().includes(palavra.toLowerCase())
      );
      if (deveSerVermelho) {
        doc.setTextColor(...vermelho);
      } else {
        doc.setTextColor(0, 0, 0);
      }
      // Desenha a linha da tabela com bordas visíveis
      doc.rect(10, y, 50, 12);
      doc.rect(60, y, 140, 12);
      // Centraliza quantidade e descrição
      doc.text(material.quantidade, 35, y + 8, { align: "center" });
      // Quebra texto longo da descrição
      const textoQuebrado = doc.splitTextToSize(material.descricao, 120);
      doc.text(textoQuebrado, 130, y + 8, { align: "center" });
      y += 12;
    });
  }

  // Carrega a logo como base64 e chama addLogoAndTitle
  fetch(logoUrl)
    .then(response => response.blob())
    .then(blob => {
      const reader = new FileReader();
      reader.onload = function (e) {
        addLogoAndTitle(e.target.result);
      };
      reader.readAsDataURL(blob);
    });
  // O resto do código (salvar PDF) é chamado após carregar a logo
  return;

  // ========== CABEÇALHO DA TABELA ==========
  let y = 45;
  doc.setFillColor(...azulPrimario);
  doc.rect(10, y, 190, 10, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Quantidade", 15, y + 7);
  doc.text("Materiais/Equipamentos", 70, y + 7);

  // ========== LINHAS DA TABELA ==========
  y += 10;
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  materiais.forEach((material, index) => {
    // Verifica se precisa criar nova página
    if (y > 270) {
      doc.addPage();
      y = 20;

      // Repete o cabeçalho na nova página
      doc.setFillColor(...azulPrimario);
      doc.rect(10, y, 190, 10, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text("Quantidade", 15, y + 7);
      doc.text("Materiais/Equipamentos", 70, y + 7);
      y += 10;
      doc.setTextColor(0, 0, 0);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
    }

    // Verifica se deve colorir de vermelho
    const deveSerVermelho = palavrasVermelhas.some(palavra =>
      material.descricao.toLowerCase().includes(palavra.toLowerCase())
    );

    if (deveSerVermelho) {
      doc.setTextColor(...vermelho);
    } else {
      doc.setTextColor(0, 0, 0);
    }

    // Desenha a linha da tabela
    doc.rect(10, y, 190, 10); // Borda da célula
    doc.text(material.quantidade, 15, y + 7);

    // Quebra texto longo da descrição
    const textoQuebrado = doc.splitTextToSize(material.descricao, 125);
    const alturaLinha = textoQuebrado.length * 5;

    if (alturaLinha > 10) {
      // Se o texto for muito longo, ajusta a altura da célula
      doc.rect(10, y, 60, alturaLinha);
      doc.rect(70, y, 130, alturaLinha);
      doc.text(textoQuebrado, 72, y + 5);
      y += alturaLinha;
    } else {
      doc.text(textoQuebrado, 72, y + 7);
      y += 10;
    }
  });

  // ========== RODAPÉ/OBSERVAÇÃO (se necessário) ==========
  // Você pode adicionar observações aqui se desejar

  // Salva o PDF
  doc.save(`Lista_Materiais_${pedidoCompra}.pdf`);
}

const rascunhosTbody = document.getElementById("rascunhos-tbody"); // corpo da tabela que exibirá os rascunhos locais
const recarregarRascunhosButton = document.getElementById("btn-recarregar-rascunhos"); // botão que força o recarregamento da lista de rascunhos
const limparRascunhosButton = document.getElementById("btn-limpar-rascunhos");

// Elementos do título e do subtítulo do formulário de avaliação, usados para indicar "Nova" ou "Editar".
const formTituloEl = document.getElementById("form-avaliacao-titulo"); // h2 acima do formulário de avaliação
const formSubtituloEl = document.getElementById("form-avaliacao-subtitulo"); // texto pequeno logo abaixo do título


// ======================= Gestão de usuários (apenas admins) =======================

// Card inteiro de gestão de usuários, mostrado apenas se o usuário logado for admin.
const userManagementCard = document.getElementById("user-management-card"); // seção com formulário + tabela

// Formulário para criar novos usuários.
const userForm = document.getElementById("form-usuario");                   // formulário de criação de usuário

// Campos do formulário de usuário.
const userNomeInput = document.getElementById("usuario-nome");              // input de nome completo
const userEmailInput = document.getElementById("usuario-email");            // input de e-mail
const userUsernameInput = document.getElementById("usuario-username");      // input de login
const userSenhaInput = document.getElementById("usuario-senha");            // input de senha inicial
const userRoleSelect = document.getElementById("usuario-role");             // select para perfil do usuário (avaliador, comercial, admin)

// Área de feedback e tabela de usuários.
const userFeedbackEl = document.getElementById("usuario-feedback");         // parágrafo para mensagens de erro/sucesso
const usuariosTbody = document.getElementById("usuarios-tbody");            // corpo da tabela de usuários

// Elementos do modal de troca de senha.                                        // comentário: agrupa todas as referências do modal
const passwordModal = document.getElementById("password-modal-overlay");        // pega o overlay do modal (div com fundo escuro e o conteúdo dentro)
const passwordForm = document.getElementById("password-change-form");           // pega o formulário interno do modal de senha
const senhaAtualInput = document.getElementById("senha_atual");                 // pega o input de senha atual (id com underline, igual ao HTML)
const novaSenhaInput = document.getElementById("nova_senha");                   // pega o input de nova senha (id com underline)
const passwordErrorEl = document.getElementById("password-modal-error");        // pega o parágrafo de erro do modal (para mensagens de validação)

// Elementos do modal de gestão de usuários.
const openUsersButton = document.getElementById("btn-open-users");      // botão na topbar que abre o modal de gestão de usuários
const usersModalOverlay = document.getElementById("users-modal-overlay"); // overlay escuro do modal de usuários
const usersTbody = document.getElementById("usuarios-tbody");           // corpo da tabela que exibirá a lista de usuários
const usersFeedbackEl = document.getElementById("usuarios-feedback");   // parágrafo usado para mensagens de erro/sucesso no modal
const closeUsersButton = document.getElementById("btn-fechar-usuarios");// botão que fecha o modal de usuários

const btnAuditoria = document.getElementById("btnAuditoria"); // pega o botão da aba Auditoria
const secAuditoria = document.getElementById("sec-auditoria"); // seção de auditoria

const equipeInput = document.getElementById("equipe-responsavel");       // input da equipe responsável
const escopoTextoInput = document.getElementById("escopo-texto");        // textarea do escopo da avaliação

if (btnAuditoria) { // se o botão existir
  btnAuditoria.addEventListener("click", () => { // adiciona listener para o clique
    if (secAuditoria) {
      if (secAuditoria.style.display === "block") {
        secAuditoria.style.display = "none";
      } else {
        secAuditoria.style.display = "block";
        inicializarTelaAuditoria(); // inicializa os controles e carrega as listas da tela de auditoria
      }
    }
  });
}

/**
 * Mostra ou esconde o botão de Auditoria.
 * Só administradores podem ver a seção de auditoria.
 * No modo offline, a auditoria fica oculta.
 */
function atualizarVisibilidadeBotaoAuditoria() {
  if (!btnAuditoria) return; // se o botão não existir, sai

  // Esconde para modo offline ou não-admin
  if (modoOfflineAtivo || !isAdmin()) {
    btnAuditoria.classList.add("hidden");
    if (secAuditoria) secAuditoria.style.display = "none"; // fecha a seção se estiver aberta
  } else {
    btnAuditoria.classList.remove("hidden");
  }
}

/**
 * Mostra ou esconde o card de gestão de usuários
 * dependendo se o usuário atual é administrador.
 */
function atualizarVisibilidadeGestaoUsuarios() {
  if (!userManagementCard) {                                   // se o HTML não tiver o card, não há nada a fazer
    return;                                                    // sai silenciosamente
  }

  if (isAdmin()) {                                             // se o usuário logado é admin
    userManagementCard.classList.remove("hidden");             // remove a classe hidden para exibir o card
    carregarUsuarios();                                        // carrega a lista de usuários sempre que o admin entrar
  } else {
    userManagementCard.classList.add("hidden");                // garante que o card fique escondido para não-admins
  }
}

/**
 * Busca no backend a lista de usuários cadastrados
 * (GET /usuarios) e preenche a tabela da tela de administração.
 */
async function carregarUsuarios() {
  if (!usuariosTbody) {                                        // se por algum motivo não houver tbody no DOM
    return;                                                    // não tenta fazer nada
  }

  // Mensagem de carregamento enquanto a requisição é feita
  usuariosTbody.innerHTML =
    '<tr><td colspan="6" class="table-empty">Carregando usuários...</td></tr>';

  try {
    const lista = await apiGet("/usuarios");                   // chama o backend para buscar todos os usuários

    if (!lista || lista.length === 0) {                        // se a lista estiver vazia
      usuariosTbody.innerHTML =
        '<tr><td colspan="6" class="table-empty">Nenhum usuário encontrado.</td></tr>';
      return;                                                  // encerra a função aqui
    }

    const linhas = lista
      .map((user) => {                                         // mapeia cada usuário para uma linha HTML
        // Determina o perfil a exibir (prioriza role, fallback para is_admin)
        let perfil = "Avaliador";
        let roleValue = user.role || "avaliador";
        if (user.role === "admin" || user.is_admin) {
          perfil = "Administrador";
          roleValue = "admin";
        } else if (user.role === "comercial") {
          perfil = "Comercial";
          roleValue = "comercial";
        } else if (user.role === "visualizador") {
          perfil = "Visualizador";
          roleValue = "visualizador";
        }
        const precisaTrocar = user.precisa_trocar_senha ? "Sim" : "Não"; // se ainda precisa trocar a senha

        // O usuário "admin" padrão não pode ter seu role alterado
        const isAdminPadrao = user.username === "admin";
        const selectDisabled = isAdminPadrao ? "disabled" : "";
        const selectTitle = isAdminPadrao ? "O usuário admin padrão não pode ser alterado" : "Alterar perfil";

        return `
          <tr>
            <td>${user.id}</td>
            <td>${user.nome}</td>
            <td>${user.username}</td>
            <td>${user.email}</td>
            <td>${perfil} · Trocar senha: ${precisaTrocar}</td>
            <td>
              <select 
                class="select-role-usuario" 
                data-usuario-id="${user.id}" 
                data-usuario-username="${user.username}"
                ${selectDisabled}
                title="${selectTitle}"
              >
                <option value="avaliador" ${roleValue === "avaliador" ? "selected" : ""}>Avaliador</option>
                <option value="visualizador" ${roleValue === "visualizador" ? "selected" : ""}>Visualizador</option>
                <option value="comercial" ${roleValue === "comercial" ? "selected" : ""}>Comercial</option>
                <option value="admin" ${roleValue === "admin" ? "selected" : ""}>Administrador</option>
              </select>
            </td>
          </tr>
        `;
      })
      .join("");                                               // junta todas as linhas em uma única string

    usuariosTbody.innerHTML = linhas;                          // injeta as linhas geradas na tabela

    // Adiciona listeners para os selects de role
    document.querySelectorAll(".select-role-usuario").forEach((select) => {
      select.addEventListener("change", handleRoleChange);     // adiciona listener para cada select
    });
  } catch (err) {
    console.error(err);                                        // registra o erro no console para debug
    usuariosTbody.innerHTML =
      '<tr><td colspan="6" class="table-empty">Erro ao carregar usuários.</td></tr>'; // mensagem de erro visível
  }
}

/**
 * Manipula a alteração de role de um usuário via select na tabela.
 * Envia requisição PATCH para o backend e recarrega a lista.
 * @param {Event} event - evento de change do select
 */
async function handleRoleChange(event) {
  const select = event.target;                                 // obtém o select que disparou o evento
  const usuarioId = select.dataset.usuarioId;                  // obtém o id do usuário do atributo data
  const usuarioUsername = select.dataset.usuarioUsername;      // obtém o username para exibir na mensagem
  const novoRole = select.value;                               // obtém o novo role selecionado

  // Mapeia role para texto amigável
  const roleTexto = {
    "avaliador": "Avaliador",
    "comercial": "Comercial",
    "admin": "Administrador",
    "visualizador": "Visualizador"
  };

  // Confirma a alteração com o usuário
  const confirmacao = confirm(
    `Deseja alterar o perfil de "${usuarioUsername}" para "${roleTexto[novoRole]}"?`
  );

  if (!confirmacao) {                                          // se o usuário cancelou
    await carregarUsuarios();                                  // recarrega a tabela para restaurar o valor anterior
    return;                                                    // não faz nada
  }

  try {
    await apiPatchJson(`/usuarios/${usuarioId}/role`, { role: novoRole });  // envia requisição para alterar role

    if (userFeedbackEl) {                                      // se existir elemento de feedback
      userFeedbackEl.textContent = `Perfil de "${usuarioUsername}" alterado para "${roleTexto[novoRole]}" com sucesso.`;
      userFeedbackEl.className = "form-feedback form-success";  // aplica estilo de sucesso
    }

    await carregarUsuarios();                                  // recarrega a lista de usuários
  } catch (err) {
    console.error(err);                                        // registra o erro no console
    if (userFeedbackEl) {                                      // se existir elemento de feedback
      userFeedbackEl.textContent = "Erro ao alterar perfil do usuário.";
      userFeedbackEl.className = "form-feedback form-error";   // aplica estilo de erro
    }
    await carregarUsuarios();                                  // recarrega para restaurar o valor anterior
  }
}

/**
 * Lê os dados do formulário de gestão de usuários
 * e envia para o backend criar um novo usuário (POST /usuarios).
 */
async function salvarUsuario(event) {
  event.preventDefault();                                      // evita reload da página ao enviar o formulário

  if (!userFeedbackEl) {                                       // se não houver elemento de feedback
    return;                                                    // não faz nada
  }

  userFeedbackEl.textContent = "";                             // limpa mensagem anterior
  userFeedbackEl.className = "form-feedback";                  // reseta classes de erro/sucesso

  const nome = userNomeInput.value.trim();                     // lê e remove espaços extras do nome
  const email = userEmailInput.value.trim();                   // lê e-mail
  const username = userUsernameInput.value.trim();             // lê login
  const senha = userSenhaInput.value.trim();                   // lê senha inicial
  const role = userRoleSelect ? userRoleSelect.value : "avaliador"; // lê o perfil selecionado

  // Validação simples de campos obrigatórios
  if (!nome || !email || !username || !senha) {                // se algum campo obrigatório estiver vazio
    userFeedbackEl.textContent =
      "Preencha todos os campos obrigatórios para criar o usuário."; // mensagem de validação
    userFeedbackEl.classList.add("form-error");                // aplica estilo de erro
    return;                                                    // interrompe o fluxo sem chamar a API
  }

  const payload = {
    nome,                                                      // nome completo
    email,                                                     // e-mail
    username,                                                  // login
    senha,                                                     // senha inicial
    is_admin: role === "admin",                                // is_admin derivado do role para compatibilidade
    role,                                                      // role: avaliador, comercial ou admin
  };

  try {
    await apiPostJson("/usuarios", payload);                   // chama o backend para criar o novo usuário

    userFeedbackEl.textContent = "Usuário criado com sucesso."; // mensagem de sucesso
    userFeedbackEl.classList.add("form-success");              // aplica estilo de sucesso

    if (userForm) {                                            // se o formulário existir
      userForm.reset();                                        // limpa os campos do formulário
    }

    await carregarUsuarios();                                  // recarrega a lista de usuários para incluir o novo
  } catch (err) {
    console.error(err);                                        // registra o erro no console
    userFeedbackEl.textContent =
      "Erro ao criar usuário. Verifique os dados informados ou se já existe outro com o mesmo login/e-mail."; // mensagem amigável
    userFeedbackEl.classList.add("form-error");                // aplica estilo de erro
  }
}

// ----------------------------------------------------------------------
// Funções utilitárias gerais
// ----------------------------------------------------------------------

/**
 * Exibe a tela de login e esconde a tela principal.
 * Chamado quando o usuário ainda não está autenticado ou fez logout.
 */
function mostrarTelaLogin() {
  // Mostra a seção de login
  loginScreen.classList.remove("hidden");
  // Esconde a seção principal do app
  appScreen.classList.add("hidden");
}

/**
 * Exibe a tela principal da aplicação (listagem + formulário de avaliação)
 * e esconde a tela de login.
 */
function mostrarTelaApp() {
  // No modo offline, não precisamos de autenticação
  if (!modoOfflineAtivo) {
    // Antes de exibir a tela principal, conferimos se há um usuário autenticado
    if (!authToken || !currentUser) {
      // Se não houver token ou objeto de usuário, tratamos como problema de autenticação
      handleAuthError(); // limpa qualquer resquício de sessão e volta para a tela de login com mensagem apropriada
      return; // interrompe a tentativa de mostrar a tela principal
    }
  }

  // Esconde a tela de login (já que temos um usuário válido ou estamos em modo offline)
  loginScreen.classList.add("hidden"); // garante que a seção de login não fique visível

  // Mostra a tela principal da aplicação com lista de avaliações e formulário
  appScreen.classList.remove("hidden"); // remove a classe que escondia a tela principal
  // Atualiza permissões e visibilidade de controles conforme o papel do usuário
  atualizarVisibilidadeBotaoAuditoria();
  atualizarVisibilidadeGestaoUsuarios();
  atualizarVisibilidadeBotaoGerarLista();
  atualizarVisibilidadeBotaoExportarPDF();
  atualizarPermissaoStatus();
  atualizarPermissaoCamposComerciais();
  aplicarPermissoesUsuarioUI();
}

/**
 * Salva o token JWT em memória e no localStorage para persistir entre recarregamentos.
 * @param {string} token - Token JWT recebido do backend.
 */
function setAuthToken(token) {
  authToken = token; // guarda em variável global
  if (token) {
    // se existir token, salva no localStorage
    localStorage.setItem("nt_avaliacoes_token", token);
  } else {
    // se token nulo/undefined, remove do localStorage
    localStorage.removeItem("nt_avaliacoes_token");
  }
}

/**
 * Recupera o token armazenado no localStorage (se existir).
 * @returns {string|null} - Token JWT ou null se não houver.
 */
function getStoredToken() {
  return localStorage.getItem("nt_avaliacoes_token"); // lê do armazenamento do navegador
}

/**
 * Função auxiliar para tratar erros de autenticação.
 * Se encontrarmos um 401/403, limpamos o token e voltamos para a tela de login.
 */
function handleAuthError() {
  // Limpa informações de autenticação
  setAuthToken(null);
  currentUser = null;
  // Opcional: mensagem de erro no login
  loginErrorEl.textContent =
    "Sua sessão expirou. Entre novamente para continuar.";
  // Mostra a tela de login
  mostrarTelaLogin();
}

/**
 * Função genérica para chamadas GET autenticadas na API.
 * @param {string} path - Caminho relativo (ex.: "/avaliacoes").
 * @returns {Promise<any>} - JSON retornado pela API.
 */
async function apiGet(path) {
  try {
    // Monta URL usando a base configurada
    const url = API_BASE_URL + path;

    // Faz a requisição GET
    const response = await fetch(url, {
      method: "GET",
      headers: {
        // Cabeçalho indicando que aceitamos JSON
        Accept: "application/json",
        // Cabeçalho de autorização com o token JWT, se existir
        Authorization: authToken ? `Bearer ${authToken}` : "",
      },
    });

    // Se a resposta indicar não autorizado, delegamos para handleAuthError
    if (response.status === 401 || response.status === 403) {
      handleAuthError();
      throw new Error("Não autorizado");
    }

    // Se vier outro erro HTTP, lançamos uma exceção genérica
    if (!response.ok) {
      throw new Error("Erro na requisição GET: " + response.status);
    }

    // Retorna o JSON parseado
    return await response.json();
  } catch (err) {
    // Apenas propagamos o erro para quem chamou
    console.error(err);
    throw err;
  }
}

/**
 * Função genérica para chamadas POST com corpo JSON e autenticação.
 * @param {string} path - Caminho relativo (ex.: "/avaliacoes").
 * @param {object} data - Objeto a ser enviado como JSON no corpo.
 * @returns {Promise<any>} - JSON retornado pela API.
 */
async function apiPostJson(path, data) {
  try {
    // Monta URL final
    const url = API_BASE_URL + path;

    // Executa a requisição POST
    const response = await fetch(url, {
      method: "POST",
      headers: {
        // Diz que estamos enviando JSON
        "Content-Type": "application/json",
        // Diz que esperamos receber JSON
        Accept: "application/json",
        // Inclui token de autorização, se existir
        Authorization: authToken ? `Bearer ${authToken}` : "",
      },
      // Converte o objeto `data` em JSON
      body: JSON.stringify(data),
    });

    // Se o backend indicar problema de autenticação, tratamos
    if (response.status === 401 || response.status === 403) {
      handleAuthError();
      throw new Error("Não autorizado");
    }

    // Se qualquer outro erro HTTP acontecer, lança erro
    if (!response.ok) {
      const text = await response.text(); // tenta ler texto de erro
      throw new Error("Erro na requisição POST: " + text);
    }

    // Retorna o corpo JSON da resposta
    return await response.json();
  } catch (err) {
    // Log simples no console para debug
    console.error(err);
    throw err;
  }
}

/**
 * Função genérica para chamadas POST sem corpo JSON, apenas autenticadas.
 * Útil para endpoints que não esperam body (ex.: resetar senha).
 * @param {string} path - Caminho relativo (ex.: "/usuarios/1/resetar-senha").
 * @returns {Promise<any>} - JSON retornado pela API.
 */
async function apiPost(path) {
  try {
    const url = API_BASE_URL + path;                              // monta a URL final juntando base e caminho

    const response = await fetch(url, {                           // faz a requisição HTTP
      method: "POST",                                             // método POST
      headers: {
        Accept: "application/json",                               // indica que esperamos JSON de resposta
        Authorization: authToken ? `Bearer ${authToken}` : "",    // envia o token JWT se existir
      },
    });

    if (response.status === 401 || response.status === 403) {     // se o backend indicar problema de autenticação/autorização
      handleAuthError();                                          // trata o erro de autenticação (limpa token e volta para login)
      throw new Error("Não autorizado");                          // lança erro para quem chamou
    }

    if (!response.ok) {                                           // se veio qualquer outro erro HTTP
      const text = await response.text();                         // tenta ler o corpo como texto para ajudar no debug
      throw new Error("Erro na requisição POST: " + text);        // lança erro com a mensagem completa
    }

    return await response.json();                                 // retorna o JSON parseado
  } catch (err) {
    console.error(err);                                           // registra o erro no console
    throw err;                                                    // propaga o erro para quem chamou
  }
}

/**
 * Função genérica para chamadas PATCH com corpo JSON e autenticação.
 * Útil para atualizações parciais (ex.: ativar/desativar usuário).
 * @param {string} path - Caminho relativo (ex.: "/usuarios/1/status").
 * @param {object} data - Objeto a ser enviado como JSON no corpo.
 * @returns {Promise<any>} - JSON retornado pela API.
 */
async function apiPatchJson(path, data) {
  try {
    const url = API_BASE_URL + path;                              // monta a URL final juntando base e caminho

    const response = await fetch(url, {                           // faz a requisição HTTP
      method: "PATCH",                                            // usa o método PATCH
      headers: {
        "Content-Type": "application/json",                       // informa que o corpo está em JSON
        Accept: "application/json",                               // indica que esperamos JSON de resposta
        Authorization: authToken ? `Bearer ${authToken}` : "",    // envia o token JWT se existir
      },
      body: JSON.stringify(data),                                 // serializa o objeto data para JSON
    });

    if (response.status === 401 || response.status === 403) {     // trata casos de não autorizado
      handleAuthError();                                          // limpa sessão e volta para login
      throw new Error("Não autorizado");                          // informa o erro para o chamador
    }

    if (!response.ok) {                                           // se veio outro erro HTTP
      const text = await response.text();                         // lê o texto de erro retornado pelo backend
      throw new Error("Erro na requisição PATCH: " + text);       // lança erro com mensagem detalhada
    }

    return await response.json();                                 // retorna o JSON da resposta
  } catch (err) {
    console.error(err);                                           // loga o erro no console
    throw err;                                                    // repassa o erro para quem chamou
  }
}

/**
 * Faz um POST multipart/form-data (para upload de arquivos), mantendo autenticação.
 * Importante: não setar Content-Type manualmente, o browser define o boundary.
 */
async function apiPostFormData(path, formData) {                     // helper para POST multipart
  try {                                                              // inicia bloco de tentativa
    const url = API_BASE_URL + path;                                 // monta URL final (base + caminho)
    const response = await fetch(url, {                              // dispara requisição fetch
      method: "POST",                                                // método HTTP POST
      headers: {                                                     // cabeçalhos HTTP
        Accept: "application/json",                                  // esperamos JSON na resposta
        Authorization: authToken ? `Bearer ${authToken}` : "",        // envia token JWT se existir
      },                                                             // fim headers
      body: formData,                                                // envia o FormData (multipart)
    });                                                              // fim fetch

    if (response.status === 401 || response.status === 403) {         // se não autorizado
      handleAuthError();                                             // força relogin / trata auth
      throw new Error("Não autorizado");                             // interrompe com erro
    }                                                                // fim if auth

    if (!response.ok) {                                              // se houve erro HTTP
      const text = await response.text().catch(() => "");             // tenta ler corpo como texto
      throw new Error("Erro na requisição POST (FormData): " + text); // lança erro com detalhe
    }                                                                // fim if !ok

    return await response.json();                                    // retorna JSON parseado
  } catch (err) {                                                    // captura erros
    console.error(err);                                              // loga no console
    throw err;                                                       // repassa erro
  }                                                                  // fim catch
}                                                                    // fim função

/**
 * Função genérica para chamadas PUT com corpo JSON e autenticação.
 * É igual à apiPostJson, mudando apenas o método HTTP para "PUT".
 * @param {string} path - Caminho relativo (ex.: "/avaliacoes/1").
 * @param {object} data - Objeto enviado como JSON no corpo.
 * @returns {Promise<any>} - JSON retornado pela API.
 */
async function apiPutJson(path, data) {
  try {
    const url = API_BASE_URL + path; // monta a URL final juntando base + caminho

    const response = await fetch(url, {
      method: "PUT", // método HTTP específico para atualização
      headers: {
        "Content-Type": "application/json", // enviamos JSON no corpo
        Accept: "application/json", // esperamos JSON na resposta
        Authorization: authToken ? `Bearer ${authToken}` : "", // envia o token JWT se existir
      },
      body: JSON.stringify(data), // converte o objeto JS em string JSON
    });

    if (response.status === 401 || response.status === 403) {
      // se o backend indicar problema de autenticação
      handleAuthError(); // força o usuário a logar de novo
      throw new Error("Não autorizado"); // interrompe o fluxo com erro
    }

    if (!response.ok) {
      // se veio outro erro HTTP qualquer
      const text = await response.text().catch(() => ""); // tenta ler o corpo como texto
      throw new Error("Erro na requisição PUT: " + text); // lança erro com detalhe bruto
    }

    return await response.json(); // devolve o JSON parseado para quem chamou
  } catch (err) {
    console.error(err); // registra o erro no console para debug
    throw err; // repassa o erro adiante
  }
}

async function apiDelete(path) {
  try {
    const url = API_BASE_URL + path; // monta a URL final juntando a base da API com o caminho recebido

    const response = await fetch(url, {
      method: "DELETE", // método HTTP específico para remoção de recursos
      headers: {
        Accept: "application/json", // indica que esperamos receber JSON na resposta
        Authorization: authToken ? `Bearer ${authToken}` : "", // envia o token JWT, se existir, para autenticação
      },
    });

    if (response.status === 401 || response.status === 403) {
      // se o backend indicar problema de autenticação/autorização
      handleAuthError(); // delega o tratamento de autenticação (logout, redirecionamento, etc.)
      throw new Error("Não autorizado"); // interrompe o fluxo com um erro específico
    }

    if (!response.ok) {
      // se qualquer outro erro HTTP acontecer
      const text = await response.text().catch(() => ""); // tenta ler o corpo como texto para detalhar o erro
      throw new Error("Erro na requisição DELETE: " + text); // lança erro com a mensagem detalhada
    }

    try {
      const data = await response.json(); // tenta interpretar a resposta como JSON
      return data; // retorna o JSON parseado se houver corpo de resposta
    } catch (_err) {
      return null; // se não houver corpo JSON, apenas retorna null (caso comum em DELETE)
    }
  } catch (err) {
    console.error(err); // registra o erro no console para auxiliar em debug
    throw err; // propaga o erro para quem chamou a função
  }
}

/**
 * Sincroniza a lista de materiais de infraestrutura de uma avaliação com o backend.
 * Estratégia: apagar todos os registros atuais da avaliação e recriar a partir da lista enviada.
 */
async function salvarListaMateriaisInfraNoBackend(
  avaliacaoId,
  listaMateriaisInfra
) {
  if (!avaliacaoId) {
    // se não houver id de avaliação, não há como associar materiais
    return; // encerra a função silenciosamente
  }

  const listaNormalizada = Array.isArray(listaMateriaisInfra)
    ? listaMateriaisInfra
    : []; // garante que sempre trabalharemos com um array (mesmo que venha indefinido)

  try {
    const existentes = await apiGet(
      `/avaliacoes/${avaliacaoId}/equipamentos`
    ); // busca no backend todos os materiais já vinculados a esta avaliação

    if (Array.isArray(existentes)) {
      // se a resposta do backend for uma lista válida
      for (const itemExistente of existentes) {
        // percorre cada material já cadastrado
        if (
          itemExistente &&
          typeof itemExistente.id === "number"
        ) {
          // garante que o registro possua um id numérico válido
          await apiDelete(
            `/equipamentos/${itemExistente.id}`
          ); // chama a API para excluir o registro de material pelo id
        }
      }
    }

    for (const item of listaNormalizada) {
      // percorre cada item da lista que queremos persistir
      const equipamento =
        item && item.equipamento
          ? item.equipamento.toString().trim()
          : ""; // normaliza o texto de equipamento/material

      const modelo =
        item && item.modelo
          ? item.modelo.toString().trim()
          : ""; // normaliza o texto de modelo, se existir

      let quantidadeInt = null; // inicializa variável numérica de quantidade
      if (
        item &&
        item.quantidade !== undefined &&
        item.quantidade !== null
      ) {
        // verifica se há algum valor de quantidade no item
        const parsed = parseInt(item.quantidade, 10); // tenta converter o valor da quantidade em inteiro
        if (!Number.isNaN(parsed) && parsed > 0) {
          // se a conversão for bem-sucedida e maior que zero
          quantidadeInt = parsed; // guarda o valor convertido
        }
      }

      const fabricante =
        item && item.fabricante
          ? item.fabricante.toString().trim()
          : ""; // normaliza o texto de fabricante, se existir

      if (!equipamento || quantidadeInt === null) {
        // se o item estiver sem equipamento ou sem quantidade válida
        continue; // ignora este item silenciosamente (supõe-se que já validamos antes no front)
      }

      const payloadEquipamento = {
        equipamento: equipamento, // nome do equipamento/material
        modelo: modelo || null, // modelo ou null se estiver em branco
        quantidade: quantidadeInt, // quantidade em formato inteiro validado
        fabricante: fabricante || null, // fabricante ou null se não informado
      }; // objeto que será enviado ao endpoint de criação de equipamentos

      await apiPostJson(
        `/avaliacoes/${avaliacaoId}/equipamentos`,
        payloadEquipamento
      ); // cria o registro de material no backend vinculado à avaliação
    }
  } catch (err) {
    console.error(
      "Erro ao sincronizar a lista de materiais de infraestrutura com o backend:",
      err
    ); // registra no console um erro detalhado da sincronização
    throw err; // propaga o erro para que o fluxo de salvamento da avaliação possa tratar
  }
}

/**
 * Carrega a lista de materiais de infraestrutura do backend
 * e preenche a tabela da interface com esses dados.
 */
async function carregarListaMateriaisInfraDoBackend(avaliacaoId) {
  if (!infraListaMateriaisTbody) {
    // se a tabela de materiais não estiver presente no DOM
    return; // encerra a função sem fazer nada
  }

  limparTabelaMateriaisInfra(); // limpa a tabela atual para não misturar dados de avaliações diferentes

  if (!avaliacaoId) {
    // se nenhum id de avaliação foi informado
    return; // não tenta chamar o backend sem saber qual avaliação carregar
  }

  try {
    const itens = await apiGet(
      `/avaliacoes/${avaliacaoId}/equipamentos`
    ); // busca no backend todos os materiais vinculados à avaliação

    if (!Array.isArray(itens) || itens.length === 0) {
      // se não vier lista válida ou se estiver vazia
      return; // mantém a tabela apenas com a linha vazia padrão
    }

    const listaParaPreencher = itens.map((item) => {
      // converte cada item retornado pela API para o formato esperado pelos helpers de UI
      return {
        equipamento:
          item && item.equipamento ? item.equipamento : "", // preserva o nome do equipamento/material
        modelo: item && item.modelo ? item.modelo : "", // preserva o modelo, se houver
        quantidade:
          item && typeof item.quantidade === "number"
            ? String(item.quantidade) // se vier como número, converte para string
            : item && item.quantidade
            ? String(item.quantidade) // se vier como string, garante que seja string
            : "", // caso contrário, deixa o campo de quantidade vazio
        fabricante:
          item && item.fabricante ? item.fabricante : "", // preserva o fabricante, se houver
      }; // objeto compatível com o formato usado pelo helper de preenchimento da tabela
    }); // fim do map sobre os itens retornados pelo backend

    preencherListaMateriaisInfraAPartirDeDados(
      listaParaPreencher
    ); // recria as linhas da tabela de materiais com base na lista carregada
  } catch (err) {
    console.error(
      "Erro ao carregar a lista de materiais de infraestrutura do backend:",
      err
    ); // registra no console um erro detalhado de carregamento
    // Em caso de erro, deixamos a avaliação carregar normalmente, apenas sem lista de materiais
  }
}

// ----------------------------------------------------------------------
// Fluxo de login e carregamento inicial
// ----------------------------------------------------------------------

/**
 * Faz o login do usuário usando o endpoint /auth/login da API.
 * O backend espera os dados em formato application/x-www-form-urlencoded,
 * padrão do OAuth2PasswordRequestForm.
 * @param {string} username - Login do usuário.
 * @param {string} password - Senha digitada.
 */
async function realizarLogin(username, password) {
  // Limpa mensagem anterior de erro
  loginErrorEl.textContent = "";

  try {
    // Monta corpo no formato de formulário URL-encoded
    const body = new URLSearchParams();
    body.append("username", username);
    body.append("password", password);
    // Opcionalmente podemos enviar grant_type, mas o FastAPI não exige
    body.append("grant_type", "password");

    // Faz a requisição para /auth/login
    const response = await fetch(API_BASE_URL + "/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    // Se credenciais inválidas, mostra mensagem amigável
    if (response.status === 400 || response.status === 401) {
      const data = await response.json().catch(() => null);
      const detail =
        data && data.detail
          ? data.detail
          : "Usuário ou senha inválidos. Tente novamente.";
      loginErrorEl.textContent = detail;
      return;
    }

    // Se qualquer outro erro HTTP acontecer, lança exceção
    if (!response.ok) {
      throw new Error("Erro ao tentar fazer login: " + response.status);
    }

    // Se deu certo, lemos o JSON com o token
    const tokenData = await response.json(); // converte a resposta da API de JSON para objeto JavaScript

    // Salva o token no helper e no localStorage
    setAuthToken(tokenData.access_token); // guarda o access_token em memória e no localStorage sob a chave de token

    // Marca no localStorage que este navegador já teve uma sessão autenticada
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(SESSION_MARKER_KEY, "1"); // grava o valor "1" indicando que já houve login bem-sucedido neste navegador
    }

    // Depois de logar, carregamos os dados do usuário
    await carregarDadosUsuario(); // chama o endpoint /auth/me para obter nome, papel (admin/avaliador) e demais dados do usuário logado

    // E então carregamos a tela principal
    mostrarTelaApp();

    // Por fim, carregamos a lista de avaliações
    await carregarAvaliacoes();

    resetarFormularioParaNovaAvaliacao(); // garante que o formulário comece como "Nova Avaliação" após o login
    renderizarListaRascunhos(); // carrega também a tabela de rascunhos locais para o usuário logado
    atualizarVisibilidadeBotaoGerarLista(); // atualiza visibilidade do botão de gerar lista de materiais

    // Se o usuário precisa trocar a senha, mostramos o modal específico
    if (currentUser && currentUser.precisa_trocar_senha) {
      abrirModalSenha();
    }
  } catch (err) {
    // Em qualquer erro inesperado, exibimos mensagem específica
    console.error(err);
    
    // Detecta tipo de erro para mensagem mais útil
    if (err.name === "TypeError" && err.message.includes("fetch")) {
      // Erro de rede (sem conexão, DNS, etc.)
      loginErrorEl.textContent =
        "Sem conexão com a internet. Verifique sua rede e tente novamente.";
    } else if (err.message && err.message.includes("Failed to fetch")) {
      // Erro de conexão com o servidor (pode estar dormindo ou offline)
      loginErrorEl.textContent =
        "Não foi possível conectar ao servidor. Ele pode estar inicializando — aguarde alguns segundos e tente novamente.";
    } else {
      // Erro genérico
      // loginErrorEl.textContent =
      //   "Erro inesperado ao fazer login. Verifique sua conexão e tente de novo.";
      loginErrorEl.innerHTML = '<span style="color: #ffffff; font-size: 0.85rem;">Erro inesperado ao fazer login. Verifique sua conexão e tente de novo.</span>';
    }
  }
}

/**
 * Busca as informações do usuário logado no endpoint /auth/me
 * e preenche a área de usuário na topbar.
 */
async function carregarDadosUsuario() {
  try {
    // Chama a API autenticada para obter os dados do usuário
    const data = await apiGet("/auth/me");

    // Guarda o objeto retornado na variável global
    currentUser = data;

    // Preenche o nome no cabeçalho
    userNameEl.textContent = currentUser.nome || currentUser.username;

    // Define o papel exibido de forma amigável baseado no role
    if (isAdmin()) {
      userRoleEl.textContent = "Administrador";
    } else if (isComercial()) {
      userRoleEl.textContent = "Comercial";
    } else if (isVisualizador()) {
      userRoleEl.textContent = "Visualizador";
    } else {
      userRoleEl.textContent = "Avaliador";
    }
    if (isAdmin() && openUsersButton) {                            // se o usuário logado for administrador e o botão existir
      openUsersButton.classList.remove("hidden");                  // remove a classe hidden para exibir o botão "Usuários" na topbar
    }

    atualizarVisibilidadeGestaoUsuarios();                     // mostra ou esconde o card de gestão de usuários conforme o perfil
    atualizarVisibilidadeBotaoAuditoria();                      // mostra ou esconde o botão de auditoria conforme o perfil
    atualizarPermissaoStatus();                                 // habilita ou desabilita o campo status conforme o perfil
    atualizarPermissaoCamposComerciais();                       // atualiza permissão dos campos comerciais
    atualizarVisibilidadeBotaoGerarLista();                     // mostra ou esconde o botão de gerar lista de materiais conforme o perfil
    atualizarVisibilidadeBotaoExportarPDF();                    // mostra ou esconde o botão de exportar PDF conforme o perfil
    // Aplica regras UI específicas do role (ex.: bloquear campos para visualizador)
    aplicarPermissoesUsuarioUI();
  } catch (err) {
    // Se falhar ao carregar o usuário, tratamos como problema de autenticação
    console.error(err);
    handleAuthError();
  }
}

/**
 * Efetua logout limpando token e dados de usuário,
 * e retornando o usuário para a tela de login.
 */
function realizarLogout() {
  // Limpa token e dados do usuário
  setAuthToken(null); // remove o token JWT armazenado (localStorage) e em memória
  currentUser = null; // limpa o objeto com dados do usuário logado

  // Reseta o modo offline se estiver ativo
  modoOfflineAtivo = false;

  // Restaura elementos que podem ter sido escondidos no modo offline
  if (recarregarButton) recarregarButton.style.display = "";
  
  // Esconde o badge de modo offline
  if (offlineBadge) offlineBadge.classList.add("hidden");

  // Reabilita o botão "Salvar avaliação"
  if (salvarAvaliacaoButton) {
    salvarAvaliacaoButton.disabled = false;
    salvarAvaliacaoButton.title = salvarAvaliacaoButton.dataset.originalTitle || "";
    salvarAvaliacaoButton.classList.remove("btn-disabled-offline");
  }

  // Como o usuário clicou em "Sair", removemos o marcador de sessão anterior
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(SESSION_MARKER_KEY); // apaga a informação de que este navegador tinha uma sessão ativa
  }

  avaliacaoEmEdicaoId = null; // garante que não mantenha nenhuma avaliação em edição após sair
  avaliacaoEmEdicaoCodigo = null; // limpa também o código da avaliação
  rascunhoEmEdicaoId = null;  // garante que nenhum rascunho continue marcado como "em edição" após o logout

  if (formAvaliacao) {
    formAvaliacao.reset(); // limpa o formulário ao fazer logout
  }

  resetarFormularioParaNovaAvaliacao(); // volta o título/subtítulo para o modo padrão (texto de "Nova avaliação")

  // Limpa eventuais mensagens do formulário de avaliação
  avaliacaoFeedbackEl.textContent = ""; // apaga qualquer feedback de sucesso/erro do formulário de avaliação

  if (userManagementCard) { // se o card de gestão de usuários existir no DOM
    userManagementCard.classList.add("hidden"); // garante que ele não apareça quando estivermos na tela de login
  }

  // Exibe a tela de login após o logout
  mostrarTelaLogin(); // troca para a tela de login, escondendo a tela principal
}

/**
 * Entra no modo offline: permite usar a aplicação sem conexão ao servidor.
 * - Não requer autenticação
 * - Permite apenas trabalhar com rascunhos locais
 * - Não carrega avaliações do servidor
 * - Não permite salvar avaliações no servidor
 */
function entrarModoOffline() {
  // Ativa a flag global de modo offline
  modoOfflineAtivo = true;

  // Define um usuário fictício para o modo offline
  currentUser = {
    id: null,
    username: "offline",
    nome: "Usuário Offline",
    role: "avaliador"
  };

  // Não armazena token (pois não há autenticação)
  setAuthToken(null);

  // Atualiza o nome/função no topbar
  if (userNameEl) userNameEl.textContent = "Modo Offline";
  if (userRoleEl) userRoleEl.textContent = "Sem conexão";

  // Mostra o badge de modo offline
  if (offlineBadge) offlineBadge.classList.remove("hidden");

  // Esconde elementos que não funcionam offline
  if (userManagementCard) userManagementCard.classList.add("hidden");
  atualizarVisibilidadeBotaoAuditoria(); // esconde botão de auditoria no modo offline
  atualizarVisibilidadeBotaoGerarLista(); // atualiza visibilidade do botão de gerar lista de materiais no modo offline

  // Mostra a tela principal
  mostrarTelaApp();

  // Carrega rascunhos locais (única funcionalidade disponível offline)
  renderizarListaRascunhos();

  // Limpa e prepara a tabela de avaliações com mensagem de modo offline
  if (avaliacoesTbody) {
    avaliacoesTbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center" style="padding: 40px 20px;">
          <div style="color: var(--nt-text-muted);">
            <div style="font-size: 2rem; margin-bottom: 10px;">📴</div>
            <div style="font-weight: 600; margin-bottom: 5px;">Modo Offline</div>
            <div style="font-size: 0.9rem;">Avaliações do servidor não disponíveis.</div>
            <div style="font-size: 0.85rem;">Use os rascunhos para criar avaliações e sincronize quando estiver online.</div>
          </div>
        </td>
      </tr>
    `;
  }

  // Esconde o botão recarregar (não faz sentido em modo offline)
  if (recarregarButton) recarregarButton.style.display = "none";

  // Desabilita o botão "Salvar avaliação" (não funciona offline)
  if (salvarAvaliacaoButton) {
    salvarAvaliacaoButton.disabled = true;
    salvarAvaliacaoButton.dataset.originalTitle = salvarAvaliacaoButton.title || "";
    salvarAvaliacaoButton.title = "Não disponível em modo offline. Use 'Salvar rascunho'.";
    salvarAvaliacaoButton.classList.add("btn-disabled-offline");
  }

  // Atualiza permissão do campo status (avaliador offline não pode alterar)
  atualizarPermissaoStatus();
  atualizarPermissaoCamposComerciais();                         // atualiza permissão dos campos comerciais
}

// ----------------------------------------------------------------------
// Modal de troca de senha
// ----------------------------------------------------------------------

/**
 * Abre o modal que exige troca de senha no primeiro acesso.
 */
function abrirModalSenha() {
  if (!passwordModal) return;                                                 // se por algum motivo o elemento não existir, sai silenciosamente

  senhaAtualInput.value = "";                                                 // limpa o campo de senha atual
  novaSenhaInput.value = "";                                                  // limpa o campo de nova senha
  passwordErrorEl.textContent = "";                                           // limpa qualquer texto de erro anterior
  passwordErrorEl.classList.add("hidden");                                    // garante que a mensagem de erro esteja escondida

  passwordModal.classList.remove("hidden");                                   // remove a classe hidden para exibir o overlay do modal
}

/**
 * Fecha o modal de troca de senha.                                           // explica que a função esconde o modal
 */
function fecharModalSenha() {
  if (!passwordModal) return;                                                 // segurança: se não existir, não faz nada
  passwordModal.classList.add("hidden");                                      // adiciona a classe hidden para esconder o overlay do modal
}

/**
 * Envia para o backend a solicitação de troca de senha usando /auth/trocar-senha.   // descrição geral da função
 * Se for bem-sucedida, atualiza o campo precisa_trocar_senha do usuário.           // explica o efeito colateral
 */
async function enviarTrocaSenha(event) {
  event.preventDefault();                                                           // impede o envio padrão do formulário (reload da página)

  passwordErrorEl.textContent = "";                                                 // limpa qualquer mensagem de erro anterior
  passwordErrorEl.classList.add("hidden");                                          // esconde o parágrafo de erro

  const senhaAtual = senhaAtualInput.value.trim();                                  // lê e remove espaços da senha atual
  const novaSenha = novaSenhaInput.value.trim();                                    // lê e remove espaços da nova senha

  if (!senhaAtual || !novaSenha) {                                                  // valida se ambos os campos foram preenchidos
    passwordErrorEl.textContent = "Preencha todos os campos.";                      // mensagem de erro para campos vazios
    passwordErrorEl.classList.remove("hidden");                                     // exibe o parágrafo de erro
    return;                                                                         // interrompe a função sem chamar a API
  }

  try {
    const payload = {                                                               // monta o objeto que será enviado para o backend
      senha_atual: senhaAtual,                                                      // envia senha atual no campo esperado pelo schema Pydantic
      nova_senha: novaSenha,                                                        // envia nova senha no campo esperado pelo schema Pydantic
    };

    const result = await apiPostJson("/auth/trocar-senha", payload);                // faz a chamada POST autenticada para /auth/trocar-senha

    if (currentUser) {                                                              // se tivermos o usuário carregado em memória
      currentUser.precisa_trocar_senha = false;                                     // atualizamos a flag local para não exigir mais troca de senha
    }

    alert(result.detail || "Senha alterada com sucesso.");                          // mostra alerta de sucesso para o usuário
    fecharModalSenha();                                                             // fecha o modal de troca de senha
  } catch (err) {
    console.error(err);                                                             // registra o erro no console para depuração

    passwordErrorEl.textContent =
      "Não foi possível alterar a senha. Verifique a senha atual e tente novamente."; // mensagem genérica de erro para o usuário
    passwordErrorEl.classList.remove("hidden");                                     // exibe o parágrafo de erro
  }
}

// ----------------------------------------------------------------------
// Listagem e criação de avaliações
// ----------------------------------------------------------------------

/**
 * Carrega a lista de avaliações do backend e preenche a tabela da coluna esquerda.
 */
async function carregarAvaliacoes() {
  // Garante que a tabela tenha pelo menos uma linha enquanto carrega
  avaliacoesTbody.innerHTML =
    '<tr><td colspan="6" class="table-empty">Carregando avaliações...</td></tr>';

  try {
    // Chama o endpoint GET /avaliacoes
    const lista = await apiGet("/avaliacoes");


    // Armazena todas as avaliações no array global para filtragem
    TODAS_AVALIACOES = lista || [];

    // Atualiza o filtro 'Criado por' sempre que carregar avaliações
    popularFiltroCriadoPor(TODAS_AVALIACOES);

    // Se a lista estiver vazia, mostramos mensagem amigável
    if (!lista || lista.length === 0) {
      avaliacoesTbody.innerHTML =
        '<tr><td colspan="6" class="table-empty">Nenhuma avaliação encontrada.</td></tr>';
      return;
    }

    // Aplica os filtros atuais (ou mostra tudo se não houver filtros)
    aplicarFiltrosAvaliacoes();

  } catch (err) {
    // Em caso de erro, mostra mensagem genérica e mantém trace no console
    console.error(err);
    avaliacoesTbody.innerHTML =
      '<tr><td colspan="6" class="table-empty">Erro ao carregar avaliações.</td></tr>';
  }
}

// ----------------------------------------------------------------------
// Gestão de usuários (somente administradores)
// ----------------------------------------------------------------------

/**
 * Carrega a lista de usuários do backend e preenche a tabela do modal.
 */
async function carregarUsuarios() {                                      // carrega a lista de usuários via API e preenche a tabela
  if (!usersTbody) {                                                     // se o corpo da tabela não existir no DOM
    return;                                                              // sai sem fazer nada (evita erros em telas sem modal)
  }

  usersTbody.innerHTML =
    '<tr><td colspan="6" class="table-empty">Carregando usuários...</td></tr>'; // mostra mensagem de carregamento enquanto espera a API

  if (usersFeedbackEl) {                                                 // se o parágrafo de feedback existir
    usersFeedbackEl.textContent = "";                                    // limpa qualquer mensagem anterior
    usersFeedbackEl.className = "form-feedback";                         // reseta as classes de estilo de feedback
  }

  try {                                                                  // inicia o bloco try/catch para tratar erros de rede
    const lista = await apiGet("/usuarios");                             // chama a API GET /usuarios para obter a lista de usuários

    if (!lista || lista.length === 0) {                                  // verifica se a lista veio vazia ou indefinida
      usersTbody.innerHTML =
        '<tr><td colspan="6" class="table-empty">Nenhum usuário encontrado.</td></tr>'; // mostra mensagem amigável de lista vazia
      return;                                                            // encerra a função
    }

    const linhas = lista                                                 // percorre a lista de usuários e monta as linhas HTML
      .map((usuario) => {                                                // para cada usuário retornado pelo backend
        const statusTexto = usuario.ativo ? "Ativo" : "Inativo";         // monta o texto do status (Ativo/Inativo)
        const labelBotao = usuario.ativo ? "Desativar" : "Ativar";       // define o texto do botão de alternância de status
        
        // Determina o role atual do usuário
        let roleValue = usuario.role || "avaliador";
        if (usuario.role === "admin" || usuario.is_admin) {
          roleValue = "admin";
        } else if (usuario.role === "comercial") {
          roleValue = "comercial";
        } else if (usuario.role === "visualizador") {
          roleValue = "visualizador";
        }

        // O usuário "admin" padrão (id=1 ou username="admin") não pode ter seu role alterado
        const isAdminPadrao = usuario.username === "admin" || usuario.id === 1;
        const selectDisabled = isAdminPadrao ? "disabled" : "";
        const selectTitle = isAdminPadrao ? "O usuário admin padrão não pode ser alterado" : "Alterar perfil";

        // Select de role (aparece para todos os usuários)
        const selectRoleHtml = `
          <select 
            class="select-role-usuario" 
            data-usuario-id="${usuario.id}" 
            data-usuario-username="${usuario.username}"
            ${selectDisabled}
            title="${selectTitle}"
          >
            <option value="avaliador" ${roleValue === "avaliador" ? "selected" : ""}>Avaliador</option>
            <option value="visualizador" ${roleValue === "visualizador" ? "selected" : ""}>Visualizador</option>
            <option value="comercial" ${roleValue === "comercial" ? "selected" : ""}>Comercial</option>
            <option value="admin" ${roleValue === "admin" ? "selected" : ""}>Administrador</option>
          </select>
        `;
        
        if(usuario.id === 1) {                             // se o usuário for o primeiro administrador
        return `
          <tr>
            <td>${usuario.id}</td>
            <td>${usuario.nome}</td>
            <td>${usuario.username}</td>
            <td>${usuario.email}</td>
            <td>${statusTexto}</td>
            <td>
              ${selectRoleHtml}
              <button type="button"
                      class="btn btn-ghost btn-small"
                      onclick="resetarSenhaUsuario(${usuario.id})">
                Resetar senha
              </button>
            </td>
          </tr>
        `;
        } else{
            return `
            <tr>
                <td>${usuario.id}</td>
                <td>${usuario.nome}</td>
                <td>${usuario.username}</td>
                <td>${usuario.email}</td>
                <td>${statusTexto}</td>
                <td>
                ${selectRoleHtml}
                <button type="button"
                        class="btn btn-ghost btn-small"
                        onclick="alternarStatusUsuario(${usuario.id}, ${usuario.ativo})">
                    ${labelBotao}
                </button>
                <button type="button"
                        class="btn btn-ghost btn-small"
                        onclick="resetarSenhaUsuario(${usuario.id})">
                    Resetar senha
                </button>
                </td>
            </tr>
            `;            
        }                                                               // devolve o HTML de uma linha da tabela para o usuário corrente
      })
      .join("");                                                         // junta todas as linhas em uma única string

    usersTbody.innerHTML = linhas;                                       // injeta as linhas montadas no corpo da tabela

    // Adiciona listeners para os selects de role
    document.querySelectorAll(".select-role-usuario").forEach((select) => {
      select.addEventListener("change", handleRoleChange);               // adiciona listener para cada select
    });
  } catch (err) {                                                        // em caso de erro na requisição
    console.error(err);                                                  // registra o erro no console para depuração
    usersTbody.innerHTML =
      '<tr><td colspan="6" class="table-empty">Erro ao carregar usuários.</td></tr>'; // exibe mensagem de erro na tabela

    if (usersFeedbackEl) {                                               // se o campo de feedback existir
      usersFeedbackEl.textContent =
        "Erro ao carregar usuários. Tente novamente em instantes.";      // mostra mensagem de erro abaixo da tabela
      usersFeedbackEl.className = "form-feedback form-error";            // aplica estilo de erro
    }
  }
}

/**
 * Abre o modal de gestão de usuários.
 */
function abrirModalUsuarios() {                                         // abre o modal de gestão de usuários
  if (!usersModalOverlay) {                                             // se o overlay não existir
    return;                                                             // encerra sem fazer nada
  }
  usersModalOverlay.classList.remove("hidden");                         // remove a classe hidden para exibir o modal
  carregarUsuarios();                                                   // carrega a lista de usuários assim que o modal é aberto
}

/**
 * Fecha o modal de gestão de usuários.
 */
function fecharModalUsuarios() {                                        // fecha o modal de gestão de usuários
  if (!usersModalOverlay) {                                             // se o overlay não existir
    return;                                                             // encerra sem fazer nada
  }
  usersModalOverlay.classList.add("hidden");                            // adiciona a classe hidden para esconder o modal
}

/**
 * Alterna o status ativo/inativo de um usuário.
 * @param {number} usuarioId - ID do usuário a ser atualizado.
 * @param {boolean} ativoAtual - Valor atual do campo ativo.
 */
async function alternarStatusUsuario(usuarioId, ativoAtual) {           // alterna o campo ativo de um usuário
  if (!usersFeedbackEl) {                                               // se o elemento de feedback não existir
    return;                                                             // encerra a função
  }

  const acao = ativoAtual ? "desativar" : "ativar";                     // define a ação textual com base no estado atual
  const confirmado = window.confirm(                                    // abre um diálogo de confirmação para o administrador
    `Tem certeza que deseja ${acao} este usuário?`                      // mensagem exibida no diálogo
  );
  if (!confirmado) {                                                    // se o administrador cancelar a ação
    return;                                                             // não prossegue com a alteração
  }

  usersFeedbackEl.textContent = "";                                     // limpa mensagens anteriores
  usersFeedbackEl.className = "form-feedback";                          // reseta classes de estilo

  try {                                                                 // inicia bloco try/catch para tratar erros da API
    const novoStatus = !ativoAtual;                                     // calcula o novo valor do campo ativo (oposto do atual)

    await apiPatchJson(`/usuarios/${usuarioId}/status`, {               // chama a API PATCH /usuarios/{id}/status
      ativo: novoStatus,                                                // envia o novo status no corpo da requisição
    });

    usersFeedbackEl.textContent = "Status do usuário atualizado.";      // mensagem de sucesso para o administrador
    usersFeedbackEl.className = "form-feedback form-success";           // aplica estilo de sucesso
    await carregarUsuarios();                                           // recarrega a lista para refletir o novo status
  } catch (err) {                                                       // em caso de erro na chamada
    console.error(err);                                                 // registra o erro no console
    usersFeedbackEl.textContent =
      "Erro ao atualizar o status do usuário.";                         // mensagem de erro exibida no modal
    usersFeedbackEl.className = "form-feedback form-error";             // aplica estilo de erro
  }
}

/**
 * Gera uma senha temporária para o usuário informado.
 * @param {number} usuarioId - ID do usuário que terá a senha resetada.
 */
async function resetarSenhaUsuario(usuarioId) {                         // reseta a senha do usuário gerando uma senha temporária
  if (!usersFeedbackEl) {                                               // se o elemento de feedback não existir
    return;                                                             // encerra a função
  }

  const confirmado = window.confirm(                                    // diálogo de confirmação para o administrador
    "Gerar uma nova senha temporária para este usuário? " +
      "A senha atual será substituída e ele precisará trocá-la no próximo login." // mensagem explicando o impacto da ação
  );
  if (!confirmado) {                                                    // se o administrador desistir da operação
    return;                                                             // não faz nada
  }

  usersFeedbackEl.textContent = "";                                     // limpa mensagens anteriores
  usersFeedbackEl.className = "form-feedback";                          // reseta classes de estilo

  try {                                                                 // bloco try/catch para chamar a API
    const resultado = await apiPost(                                    // chama o endpoint POST de reset de senha
      `/usuarios/${usuarioId}/resetar-senha`                            // monta a URL com o id do usuário
    );

    const senhaTemporaria = resultado.senha_temporaria || "";          // lê a senha temporária retornada pela API
    if (senhaTemporaria) {                                             // se a senha foi retornada corretamente
      usersFeedbackEl.textContent =
        `Senha temporária gerada: ${senhaTemporaria}`;                 // exibe a senha temporária para o administrador
      usersFeedbackEl.className = "form-feedback form-success";        // aplica estilo de sucesso
      window.alert("Senha temporária gerada: " + senhaTemporaria);
    } else {                                                           // se por algum motivo a senha não veio no payload
      usersFeedbackEl.textContent =
        "Senha temporária gerada, mas não foi possível exibi-la.";     // mensagem neutra informando sucesso parcial
      usersFeedbackEl.className = "form-feedback form-error";          // aplica estilo de aviso/erro leve
    }
  } catch (err) {                                                      // em caso de erro na requisição
    console.error(err);                                                // registra o erro no console
    usersFeedbackEl.textContent =
      "Erro ao resetar a senha do usuário.";                           // mensagem de erro exibida no modal
    usersFeedbackEl.className = "form-feedback form-error";            // aplica estilo de erro
  }
}

/**
 * Busca os dados completos de uma avaliação no backend
 * e preenche o formulário no modo edição.
 * @param {number} avaliacaoId - ID da avaliação a ser carregada.
 */
async function carregarAvaliacaoParaEdicao(avaliacaoId) {
  try {
    const dados = await apiGet(`/avaliacoes/${avaliacaoId}`); // chama GET /avaliacoes/{id} na API

    avaliacaoEmEdicaoId = dados.id;                          // guarda o id da avaliação em edição
    avaliacaoEmEdicaoCodigo = dados.codigo_avaliacao || dados.codigo || `#${dados.id}`; // guarda o código da avaliação
    //tipo_formulario
    const tipoBruto = dados.tipo_formulario || "utp_fibra";          // lê o tipo de formulário vindo da API ou assume "utp_fibra" como padrão
    const tipoNormalizado = tipoBruto.toString().toLowerCase();      // normaliza para minúsculas (aceita valores legados como "redes"/"infra")

    if (tipoFormularioInput) {                                       // se o input hidden existir
      tipoFormularioInput.value = tipoNormalizado;                   // grava o tipo normalizado da avaliação no campo hidden
    }

    aplicarVisibilidadeTipoFormulario(tipoNormalizado);              // aplica a visibilidade dos blocos/abas de acordo com o tipo carregado
    //tipo_formulario

    // Ajusta o título/subtítulo para indicar que estamos editando
    if (formTituloEl) {
      formTituloEl.textContent = `${dados.objeto}`;          // ex.: "Editar Avaliação #3"
    }

    if (formSubtituloEl) {
      formSubtituloEl.textContent =
        "Altere os dados necessários e clique em “Salvar avaliação” para gravar as mudanças."; // instrução de edição
    }

    // Preenche os campos do formulário com os valores retornados
    const nomeCliente = dados.cliente_nome || "";                 // valor bruto do nome do cliente vindo da API

    if (clienteNomeInput) {                                       // se o select de cliente existir
      const opcoesFixas = [                                      // lista de clientes fixos configurados no select
        "Novo Nordisk",
        "FFEX",
        "Somai",
        "União Química",
        "CSN",
        "Alpargatas",
        "Eurofarma",
        "Cristália",
        "Santo Agostino",
        "Cervantes",
      ];

      let valorSelect = "";                                      // valor que será aplicado no select de cliente
      let textoOutro = "";                                       // texto que será aplicado no campo de "Outro"
      const prefixoOutro = "Outro: ";                            // prefixo usado ao salvar clientes livres

      if (!nomeCliente) {                                        // se vier vazio do backend
        valorSelect = "";                                        // mantemos o select sem seleção
        textoOutro = "";                                         // e o campo de "Outro" vazio
      } else if (opcoesFixas.includes(nomeCliente)) {            // se o nome for exatamente uma das opções fixas
        valorSelect = nomeCliente;                               // seleciona diretamente a opção no combo
        textoOutro = "";                                         // não há valor de "Outro"
      } else if (nomeCliente.startsWith(prefixoOutro)) {         // se começar com "Outro: "
        valorSelect = "outro";                                   // seleciona a opção "Outro" no combo
        textoOutro = nomeCliente.substring(prefixoOutro.length); // pega somente o texto após "Outro: "
      } else {                                                   // qualquer outro texto (registros antigos ou nomes não catalogados)
        valorSelect = "outro";                                   // trata como "Outro"
        textoOutro = nomeCliente;                                // preserva o texto original no campo "Outro"
      }

      clienteNomeInput.value = valorSelect;                      // aplica o valor calculado ao select

      if (clienteNomeOutroInput) {                               // se o input de "Outro" existir
        clienteNomeOutroInput.value = textoOutro;                // aplica o texto calculado ao campo "Outro"
      }

      atualizarVisibilidadeClienteOutro();                       // ajusta a visibilidade do campo "Outro" conforme seleção atual
      // Patch panel - visibilidade da linha de modelo e do campo "Outro"
      atualizarVisibilidadeModeloPatchPanel();        // ajusta a visibilidade da linha de modelo com base em q1_novo_patch_panel
      atualizarVisibilidadeModeloPatchPanelOutro();   // ajusta a visibilidade do campo "Outro" com base no valor de q1_modelo_patch_panel
    }
    dataAvaliacaoInput.value = dados.data_avaliacao || ""; // data no formato YYYY-MM-DD
    localInput.value = dados.local || ""; // local
    objetoInput.value = dados.objeto || ""; // objeto
    statusSelect.value = dados.status || "aberto"; // status, com fallback

    // Campos comerciais (Pedido de Compra e Número da Proposta)
    const pedidoCompraInput = document.getElementById("pedido-compra");
    const numeroPropostaInput = document.getElementById("numero-proposta");
    if (pedidoCompraInput) pedidoCompraInput.value = dados.pedido_compra || "";
    if (numeroPropostaInput) numeroPropostaInput.value = dados.numero_proposta || "";
    atualizarPermissaoCamposComerciais(); // atualiza visibilidade/permissão após carregar dados

    equipeSelect.value = dados.equipe || ""; // equipe responsável
    responsavelInput.value = dados.responsavel_avaliacao || ""; // responsável técnico
    contatoInput.value = dados.contato || ""; // contato do cliente
    emailClienteInput.value = dados.email_cliente || ""; // e-mail do cliente
    escopoTextarea.value = dados.escopo_texto || ""; // escopo / observações
    // Flags gerais
    // Flags gerais
    if (servicoForaMC) {                                                    // verifica se o <select> de serviço fora de Montes Claros existe
      booleanParaSelectSimNao(                                              // usa helper para preencher o <select> baseado em um booleano
        servicoForaMC,                                                      // referência ao <select id="servico-fora-montes-claros">
        dados.servico_fora_montes_claros                                    // valor booleano vindo da API (true/false ou null)
      );
    }
    if (servicoIntermediario) {                                             // verifica se o <select> de serviço intermediário/empreiteira existe
      booleanParaSelectSimNao(                                              // usa helper para preencher o <select> baseado em um booleano
        servicoIntermediario,                                               // referência ao <select id="servico-intermediario">
        dados.servico_intermediario                                         // valor booleano vindo da API (true/false ou null)
      );
    }

    // Quantitativo 01 – Patch Panel / Cabeamento
    if (q1Categoria) {
      q1Categoria.value = dados.q1_categoria_cab || "";          // preenche categoria do cabeamento
    }
    if (q1Blindado) {
      booleanParaSelectSimNao(q1Blindado, dados.q1_blindado);    // preenche select de cabeamento blindado
    }
    if (q1NovoPatch) {
      booleanParaSelectSimNao(
        q1NovoPatch,
        dados.q1_novo_patch_panel
      );                                                          // preenche select "Necessita novo patch panel?"
    }
    if (q1IncluirGuia) {
      booleanParaSelectSimNao(
        q1IncluirGuia,
        dados.q1_incluir_guia
      );                                                          // preenche select "Incluir guia de cabos?"
    }
    if (q1QtdGuiasCabos){
      q1QtdGuiasCabos.value = dados.q1_qtd_guias_cabos ?? "";        // preenche quantidade de guias de cabos
    }
    if (q1QtdPontosRede) {
      q1QtdPontosRede.value = dados.q1_qtd_pontos_rede || "";     // preenche quantidade de pontos de rede
    }
    if (q1QtdCabos) {
      q1QtdCabos.value = dados.q1_qtd_cabos || "";                // preenche quantidade de cabos
    }
    if (q1QtdPortasPP) {
      q1QtdPortasPP.value = dados.q1_qtd_portas_patch_panel || ""; // preenche quantidade de portas no patch panel
    }
    if (q1QtdPatchCords) {
      q1QtdPatchCords.value = dados.q1_qtd_patch_cords || "";     // preenche quantidade de patch cords
    }

    if (q1ModeloPatchPanel) {                                     // se o select de modelo de patch panel existir
      const modelo = dados.q1_modelo_patch_panel || "";           // valor bruto de modelo vindo da API
      const opcoesFixasModelo = [                                 // lista de opções fixas do combo de modelo
        "CommScope 24 portas",                                    // opção fixa 1
        "Furukawa 24 portas",                                     // opção fixa 2
        "Systimax 24 portas",                                     // opção fixa 3
      ];
      const prefixoOutroModelo = "Outro: ";                       // prefixo usado quando o valor foi salvo como "Outro: <texto>"

      let valorSelectModelo = "";                                 // variável que guardará o valor aplicado ao select
      let textoOutroModelo = "";                                  // variável que guardará o texto aplicado no campo "Outro"

      if (!modelo) {                                              // se não houver valor salvo no campo de modelo
        valorSelectModelo = "";                                   // deixa o select sem seleção
        textoOutroModelo = "";                                    // limpa também o campo de "Outro"
      } else if (opcoesFixasModelo.includes(modelo)) {            // se o valor for exatamente uma das opções fixas
        valorSelectModelo = modelo;                               // seleciona diretamente o valor no combo
        textoOutroModelo = "";                                    // não há texto adicional de "Outro"
      } else if (modelo.startsWith(prefixoOutroModelo)) {         // se o valor começar com o prefixo "Outro: "
        valorSelectModelo = "outro";                              // seleciona a opção "Outro" no combo
        textoOutroModelo = modelo.substring(                      // extrai apenas a parte após o prefixo
          prefixoOutroModelo.length                               // usa o tamanho do prefixo para cortar a string
        );
      } else {                                                    // qualquer outro valor (dados antigos ou texto livre)
        valorSelectModelo = "outro";                              // trata como se fosse "Outro"
        textoOutroModelo = modelo;                                // preserva o valor original no campo de texto
      }

      q1ModeloPatchPanel.value = valorSelectModelo;               // aplica o valor calculado ao select de modelo

      if (q1ModeloPatchPanelOutroInput) {                         // se o input "Outro" de modelo existir
        q1ModeloPatchPanelOutroInput.value = textoOutroModelo;    // aplica o texto correspondente ao input
      }
    }

    atualizarVisibilidadeModeloPatchPanel();                      // garante que a linha de modelo esteja coerente com o "novo patch panel?"
    atualizarVisibilidadeModeloPatchPanelOutro();                 // garante que o campo "Outro" de modelo esteja coerente com o select
    atualizarVisibilidadeQtdGuiasCabos();                            // ajusta a visibilidade da quantidade de guias de cabos de acordo com o valor carregado

    if (q1MarcaCab) {                                             // se o select de marca de cabeamento existir
      const marca = dados.q1_marca_cab || "";                     // lê o valor bruto de marca vindo da API
      const opcoesFixasMarca = [                                  // lista de marcas fixas disponíveis
        "CommScope",                                              // marca CommScope
        "Furukawa",                                               // marca Furukawa
      ];
      const prefixoOutroMarca = "Outro: ";                        // prefixo para valores salvos como "Outro: <texto>"

      let valorSelectMarca = "";                                  // variável que guardará o valor aplicado ao select de marca
      let textoOutroMarca = "";                                   // variável que guardará o texto do campo "Outro" de marca

      if (!marca) {                                               // se não houver valor de marca salvo
        valorSelectMarca = "";                                    // deixa o select sem seleção
        textoOutroMarca = "";                                     // limpa também o texto de "Outro"
      } else if (opcoesFixasMarca.includes(marca)) {              // se a marca for exatamente uma das marcas fixas
        valorSelectMarca = marca;                                 // seleciona essa marca no combo
        textoOutroMarca = "";                                     // não há texto adicional
      } else if (marca.startsWith(prefixoOutroMarca)) {           // se começar com "Outro: "
        valorSelectMarca = "outro";                               // seleciona a opção "Outro" no combo de marca
        textoOutroMarca = marca.substring(                        // extrai somente o texto após o prefixo
          prefixoOutroMarca.length                                // usa o tamanho do prefixo para cortar a string
        );
      } else {                                                    // qualquer outro valor (dados antigos ou marcas livres)
        valorSelectMarca = "outro";                               // trata como "Outro"
        textoOutroMarca = marca;                                  // preserva a marca original no campo de texto
      }

      q1MarcaCab.value = valorSelectMarca;                        // aplica o valor calculado ao select de marca

      if (q1MarcaCabOutroInput) {                                 // se o input de "Outro" de marca existir
        q1MarcaCabOutroInput.value = textoOutroMarca;             // aplica o texto correspondente ao campo "Outro"
      }

      if (typeof atualizarVisibilidadeMarcaCabOutro === "function") { // se a função específica de marca estiver definida
        atualizarVisibilidadeMarcaCabOutro();                     // atualiza a visibilidade do campo "Outro" de marca
      }
    }
    if (q1QtdGuiasCabos)
      q1QtdGuiasCabos.value = dados.q1_qtd_guias_cabos ?? "";                             // quantidade de guias de cabos
    if (q1PatchCordsModelo) {                                       // se o select de modelo dos patch cords existir
      const modelo = dados.q1_patch_cords_modelo || "";             // lê o valor bruto vindo da API (texto armazenado no banco)
      const opcoesFixasModeloPatch = [                              // lista de modelos padronizados para os patch cords
        "0,5 mt",                                                   // modelo de patch cord de 0,5 metro
        "1,5 mt",                                                   // modelo de patch cord de 1,5 metro
        "3,0 mt",                                                   // modelo de patch cord de 3,0 metros
        "5mt",                                                      // modelo de patch cord de 5 metros
        "10mt",                                                     // modelo de patch cord de 10 metros
        "15mt",                                                     // modelo de patch cord de 15 metros
      ];

      if (modelo && !opcoesFixasModeloPatch.includes(modelo)) {     // se houver valor salvo e ele não estiver na lista de opções fixas
        const optionLegado = document.createElement("option");      // cria dinamicamente uma nova option para representar o valor legado
        optionLegado.value = modelo;                                // define o value da option como o texto salvo no banco
        optionLegado.textContent = modelo;                          // define o texto visível da option igual ao valor salvo
        q1PatchCordsModelo.appendChild(optionLegado);               // adiciona essa option ao select, preservando o valor em registros antigos
      }

      q1PatchCordsModelo.value = modelo || "";                      // aplica o valor (fixo ou legado) ao select
    }

    if (q1PatchCordsCor) {                                          // se o select de cor dos patch cords existir
      const cor = dados.q1_patch_cords_cor || "";                   // lê a cor salva na API (texto)
      const opcoesFixasCorPatch = [                                 // lista de cores padronizadas
        "branco",                                                   // cor branca
        "amarelo",                                                  // cor amarela
        "cinza",                                                    // cor cinza
        "vermelho",                                                 // cor vermelha
        "azul",                                                     // cor azul
      ];

      if (cor && !opcoesFixasCorPatch.includes(cor)) {              // se houver cor salva e não for uma das opções padrão
        const optionLegadoCor = document.createElement("option");   // cria uma option dinâmica para essa cor
        optionLegadoCor.value = cor;                                // value da option recebe a cor salva
        optionLegadoCor.textContent = cor;                          // texto visível também mostra essa cor
        q1PatchCordsCor.appendChild(optionLegadoCor);               // adiciona a option ao select para preservar registros antigos
      }

      q1PatchCordsCor.value = cor || "";                            // aplica a cor (padrão ou legado) ao select
    }
    if (q1PatchPanelExistenteNome)
      q1PatchPanelExistenteNome.value = dados.q1_patch_panel_existente_nome || "";        // identificação do patch panel existente

    // Quantitativo 02 – Switch
    if (q2NovoSwitch) {
      booleanParaSelectSimNao(q2NovoSwitch, dados.q2_novo_switch);            // preenche select com "sim"/"nao" para novo switch
    }
    if (q2FornecedorSwitch) {
      q2FornecedorSwitch.value = dados.q2_fornecedor_switch || "";            // fornecedor do switch ("quotation_evaluation"/"cliente" ou vazio)
    }
    atualizarVisibilidadeFornecedorSwitch();                          // ajusta a visibilidade do fornecedor com base nos dados carregados
    if (q2ModeloSwitch) {
      q2ModeloSwitch.value = dados.q2_modelo_switch || "";                    // modelo do switch
    }
    if (q2SwitchFotoUrl) {
      q2SwitchFotoUrl.value = dados.q2_switch_foto_url || "";                 // URL da foto do switch
    }
    // Q2 Switch - carrega imagens do backend
    if (window.q2SwitchImagens && typeof window.q2SwitchImagens.setLinhas === "function") {
      try {
        const imagensQ2 = await apiGet(
          `/avaliacoes/${dados.id}/imagens?contexto=q2_switch`
        );

        if (imagensQ2 && imagensQ2.length > 0) {
          const linhasParaUI = imagensQ2.map((img) => ({
            id: "q2sw_" + (img.id || Date.now()) + "_" + Math.random().toString(16).slice(2),
            url: img.url || "",
            descricao: img.descricao || ""
          }));
          window.q2SwitchImagens.setLinhas(linhasParaUI);
        } else {
          window.q2SwitchImagens.resetFromEmpty();
        }
      } catch (errImg) {
        console.warn("Erro ao carregar imagens do switch:", errImg);
        window.q2SwitchImagens.resetFromLegacy();
      }
    }

    // Localização / Imagens (blocos dinâmicos) - carrega imagens do backend
    if (window.localizacaoImagens && typeof window.localizacaoImagens.setLinhas === "function") {
      try {
        const imagensLocalizacao = await apiGet(
          `/avaliacoes/${dados.id}/imagens?contexto=localizacao`
        );

        if (imagensLocalizacao && imagensLocalizacao.length > 0) {
          const linhasParaUI = imagensLocalizacao.map((img) => ({
            id: "loc_" + (img.id || Date.now()) + "_" + Math.random().toString(16).slice(2),
            url: img.url || "",
            descricao: img.descricao || ""
          }));
          window.localizacaoImagens.setLinhas(linhasParaUI);
        } else {
          window.localizacaoImagens.resetFromEmpty();
        }
      } catch (errImg) {
        console.warn("Erro ao carregar imagens de localização:", errImg);
        window.localizacaoImagens.resetFromEmpty();
      }
    }
    
    if (q2ObsSwitch) {
      q2ObsSwitch.value = dados.q2_observacoes || "";                         // observações sobre switches
    }

    // Quantitativo 03 – Cabeamento Óptico
    if (q3TipoFibra) {
      q3TipoFibra.value = dados.q3_tipo_fibra || "";                          // tipo de fibra
    }
    if (q3QtdFibrasPorCabo) {
      q3QtdFibrasPorCabo.value = dados.q3_qtd_fibras_por_cabo ?? "";          // fibras por cabo
    }
    if (q3TipoConector) {
      q3TipoConector.value = dados.q3_tipo_conector || "";                    // tipo de conector
    }
    if (q3ModeloDio) {                                                               // se o campo de modelo do DIO existir
      q3ModeloDio.value = dados.q3_modelo_dio || "";                                // preenche com o valor vindo da API ou deixa vazio
    }

    if (q3NovoDio) {                                                                 // se o select "Necessário novo DIO?" existir
      booleanParaSelectSimNao(q3NovoDio, dados.q3_novo_dio);                         // usa diretamente o booleano q3_novo_dio do backend para marcar "sim" ou "nao" no select
    }

    atualizarVisibilidadeModeloDio();                                                // ajusta a visibilidade do modelo conforme o valor carregado

    if (q3CaixaTerminacao) {
      booleanParaSelectSimNao(q3CaixaTerminacao, dados.q3_caixa_terminacao);  // preenche select "caixa de terminação?"
    }
    if (q3CaixaEmenda) {
      booleanParaSelectSimNao(q3CaixaEmenda, dados.q3_caixa_emenda);          // preenche select "caixa de emenda?"
    }
    if (q3QtdCabos) {
      q3QtdCabos.value = dados.q3_qtd_cabos ?? "";                            // quantidade de cabos ópticos
    }
    if (q3TamanhoTotal) {
      q3TamanhoTotal.value = dados.q3_tamanho_total_m ?? "";                  // metragem total
    }
    if (q3QtdCordoesOpticos) {
      q3QtdCordoesOpticos.value = dados.q3_qtd_cordoes_opticos ?? "";         // quantidade de cordões ópticos
    }
    if (q3MarcaCabOptico) {
      q3MarcaCabOptico.value = dados.q3_marca_cab_optico || "";               // marca do cabo óptico
    }
    if (q3ModeloCordaoOptico) {
      q3ModeloCordaoOptico.value = dados.q3_modelo_cordao_optico || "";       // modelo do cordão óptico
    }

    if (q3Obs) {
      q3Obs.value = dados.q3_observacoes || "";
    }

    if (q3MarcaCabOptico) {                                                      // se o select de marca do cabo óptico existir
      const marcaOptica = dados.q3_marca_cab_optico || "";                       // lê o valor bruto da API (pode ser fixo ou "Outro: <texto>")
      const opcoesFixasMarcaOptica = [                                           // lista de marcas padronizadas para cabo óptico
        "Furukawa",                                                              // marca Furukawa
        "CommScope",                                                             // marca CommScope
      ];
      const prefixoOutroMarcaOptica = "Outro: ";                                 // prefixo usado quando o valor foi salvo como "Outro: <texto>"

      let valorSelectMarcaOptica = "";                                           // valor que será aplicado ao select
      let textoOutroMarcaOptica = "";                                            // texto que será aplicado ao campo "Outro"

      if (!marcaOptica) {                                                        // se não houver valor salvo
        valorSelectMarcaOptica = "";                                             // deixa o select sem seleção
        textoOutroMarcaOptica = "";                                              // e o campo de "Outro" vazio
      } else if (opcoesFixasMarcaOptica.includes(marcaOptica)) {                // se for exatamente uma das marcas fixas
        valorSelectMarcaOptica = marcaOptica;                                    // seleciona essa marca
        textoOutroMarcaOptica = "";                                              // não há texto de "Outro"
      } else if (marcaOptica.startsWith(prefixoOutroMarcaOptica)) {             // se começar com "Outro: "
        valorSelectMarcaOptica = "outro";                                        // seleciona a opção "Outro"
        textoOutroMarcaOptica = marcaOptica.substring(                           // extrai apenas o texto após o prefixo
          prefixoOutroMarcaOptica.length                                         // usa o tamanho do prefixo para cortar a string
        );
      } else {                                                                   // qualquer outro valor livre (dados antigos/legados)
        valorSelectMarcaOptica = "outro";                                        // trata como "Outro"
        textoOutroMarcaOptica = marcaOptica;                                     // preserva o valor original no campo de texto
      }

      q3MarcaCabOptico.value = valorSelectMarcaOptica;                           // aplica o valor calculado ao select

      if (q3MarcaCabOpticoOutroInput) {                                          // se o input de "Outro" existir
        q3MarcaCabOpticoOutroInput.value = textoOutroMarcaOptica;               // aplica o texto correspondente
      }

      atualizarVisibilidadeMarcaCaboOpticoOutro();                               // ajusta a visibilidade do campo "Outro" conforme o valor carregado
    }


    // Quantitativo 04 – Equipamentos
    if (q4Camera) {
      booleanParaSelectSimNao(q4Camera, dados.q4_camera);                      // preenche select da flag "Câmera?"
    }
    if (q4NvrDvr) {
      booleanParaSelectSimNao(q4NvrDvr, dados.q4_nvr_dvr);                     // preenche select da flag "NVR/DVR?"
    }
    if (q4CameraNova) {
      booleanParaSelectSimNao(q4CameraNova, dados.q4_camera_nova);             // preenche select "Câmera nova/realocação?"
      q4CameraNova.value = "";
    }
    if (q4CameraFornecedor) {
      q4CameraFornecedor.value = dados.q4_camera_fornecedor || "";             // fornecedor da câmera
    }
    if (q4CameraModelo) {
      q4CameraModelo.value = dados.q4_camera_modelo || "";                     // modelo da câmera
    }
    if (q4CameraQtd) {
      q4CameraQtd.value = dados.q4_camera_qtd ?? "";                           // quantidade de câmeras
    }
    if (q4NvrDvrModelo) {
      q4NvrDvrModelo.value = dados.q4_nvr_dvr_modelo || "";                    // modelo do NVR/DVR
    }

    atualizarVisibilidadeCamera();
    atualizarVisibilidadeNvrdvr();

    // Quantitativo 05 – Infraestrutura
    if (q5NovaEletrocalha) {
      booleanParaSelectSimNao(q5NovaEletrocalha, dados.q5_nova_eletrocalha);      // preenche select de nova eletrocalha
    }
    if (q5NovoEletroduto) {
      booleanParaSelectSimNao(q5NovoEletroduto, dados.q5_novo_eletroduto);        // preenche select de novo eletroduto
    }
    if (q5NovoRack) {
      booleanParaSelectSimNao(q5NovoRack, dados.q5_novo_rack);                    // preenche select de novo rack
    }
    if (q5InstalacaoEletrica) {
      booleanParaSelectSimNao(q5InstalacaoEletrica, dados.q5_instalacao_eletrica);// preenche select de instalação elétrica
    }
    if (q5Nobreak) {
      booleanParaSelectSimNao(q5Nobreak, dados.q5_nobreak);                        // preenche select de nobreak
    }
    if (q5Serralheria) {
      booleanParaSelectSimNao(q5Serralheria, dados.q5_serralheria);                // preenche select de serralheria
    }

    if (q5EletrocalhaModelo) {
      q5EletrocalhaModelo.value = dados.q5_eletrocalha_modelo || "";               // modelo da eletrocalha
    }
    if (q5EletrocalhaQtd) {
      q5EletrocalhaQtd.value = dados.q5_eletrocalha_qtd ?? "";                     // quantidade de eletrocalhas
    }
    if (q5EletrodutoModelo) {
      q5EletrodutoModelo.value = dados.q5_eletroduto_modelo || "";                 // modelo do eletroduto
    }
    if (q5EletrodutoQtd) {
      q5EletrodutoQtd.value = dados.q5_eletroduto_qtd ?? "";                       // quantidade de eletrodutos
    }
    if (q5RackModelo) {
      q5RackModelo.value = dados.q5_rack_modelo || "";                             // modelo do rack
    }
    if (q5RackQtd) {
      q5RackQtd.value = dados.q5_rack_qtd ?? "";                                   // quantidade de racks
    }
    if (q5NobreakModelo) {
      q5NobreakModelo.value = dados.q5_nobreak_modelo || "";                       // modelo do nobreak
    }
    if (q5NobreakQtd) {
      q5NobreakQtd.value = dados.q5_nobreak_qtd ?? "";                             // quantidade de nobreaks
    }
    if (q5SerralheriaDescricao) {
      q5SerralheriaDescricao.value = dados.q5_serralheria_descricao || "";         // descrição da serralheria
    }
    if (q5InstalacaoEletricaObs) {
      q5InstalacaoEletricaObs.value = dados.q5_instalacao_eletrica_obs || "";      // observações da instalação elétrica
    }

    // Quantitativo 09 - Análise de Painel de Automação (Controle de Acesso)
    if (q9TensaoFonte) q9TensaoFonte.value = dados.q9_tensao_fonte || "";
    if (q9TensaoFonteOutro) q9TensaoFonteOutro.value = dados.q9_tensao_fonte_outro || "";
    if (q9NovoCabeamento) booleanParaSelectSimNao(q9NovoCabeamento, dados.q9_novo_cabeamento);
    if (q9TipoCabeamento) q9TipoCabeamento.value = dados.q9_tipo_cabeamento || "";
    if (q9TipoCabeamentoOutro) q9TipoCabeamentoOutro.value = dados.q9_tipo_cabeamento_outro || "";
    if (q9QuantidadeMetros) q9QuantidadeMetros.value = dados.q9_quantidade_metros || "";

    // Q9 - Tabela de Materiais do Painel
    if (dados.materiais_painel && Array.isArray(dados.materiais_painel)) {
      preencherQ9MateriaisPainelAPartirDeDados(dados.materiais_painel);
    }

    // Atualizar visibilidade dos campos condicionais Q9
    atualizarVisibilidadeQ9TensaoFonteOutro();
    atualizarVisibilidadeQ9Cabeamento();
    atualizarVisibilidadeQ9TipoCabeamentoOutro();

    // Quantitativo 10 - Portas (Controle de Acesso)
    if (q10TipoPorta) q10TipoPorta.value = dados.q10_tipo_porta || "";
    if (q10ServoMotor) booleanParaSelectSimNao(q10ServoMotor, dados.q10_servo_motor);
    if (q10ServoMotorQtd) q10ServoMotorQtd.value = dados.q10_servo_motor_qtd || "";
    if (q10PontoEletricoNovo) booleanParaSelectSimNao(q10PontoEletricoNovo, dados.q10_ponto_eletrico_novo);
    if (q10SuporteEletroima) booleanParaSelectSimNao(q10SuporteEletroima, dados.q10_suporte_eletroimã);
    if (q10SuporteEletroimaQtd) q10SuporteEletroimaQtd.value = dados.q10_suporte_eletroimã_qtd || "";
    if (q10BotoeiraSaida) booleanParaSelectSimNao(q10BotoeiraSaida, dados.q10_botoeira_saida);
    if (q10BotoeiraSaidaQtd) q10BotoeiraSaidaQtd.value = dados.q10_botoeira_saida_qtd || "";
    if (q10BotoeiraEmergencia) booleanParaSelectSimNao(q10BotoeiraEmergencia, dados.q10_botoeira_emergencia);
    if (q10BotoeiraEmergenciaQtd) q10BotoeiraEmergenciaQtd.value = dados.q10_botoeira_emergencia_qtd || "";
    if (q10LeitorCartao) booleanParaSelectSimNao(q10LeitorCartao, dados.q10_leitor_cartao);
    if (q10LeitorCartaoQtd) q10LeitorCartaoQtd.value = dados.q10_leitor_cartao_qtd || "";
    if (q10LeitorFacial) booleanParaSelectSimNao(q10LeitorFacial, dados.q10_leitor_facial);
    if (q10LeitorFacialQtd) q10LeitorFacialQtd.value = dados.q10_leitor_facial_qtd || "";
    if (q10SensorPresenca) booleanParaSelectSimNao(q10SensorPresenca, dados.q10_sensor_presenca);
    if (q10SensorPresencaQtd) q10SensorPresencaQtd.value = dados.q10_sensor_presenca_qtd || "";
    if (q10SensorBarreira) booleanParaSelectSimNao(q10SensorBarreira, dados.q10_sensor_barreira);
    if (q10SensorBarreiraQtd) q10SensorBarreiraQtd.value = dados.q10_sensor_barreira_qtd || "";

    // Novos campos Q10 (Expansão)
    // Eletroímã/Fechadura
    if (q10EletroimãFechadura) booleanParaSelectSimNao(q10EletroimãFechadura, dados.q10_eletroimã_fechadura);
    if (q10EletroimãFechaduraModelo) q10EletroimãFechaduraModelo.value = dados.q10_eletroimã_fechadura_modelo || "";
    if (q10EletroimãFechaduraQtd) q10EletroimãFechaduraQtd.value = dados.q10_eletroimã_fechadura_qtd || "";

    // Mola Hidráulica
    if (q10MolaHidraulica) booleanParaSelectSimNao(q10MolaHidraulica, dados.q10_mola_hidraulica);
    if (q10MolaHidraulicaTipo) q10MolaHidraulicaTipo.value = dados.q10_mola_hidraulica_tipo || "";
    if (q10MolaHidraulicaQtd) q10MolaHidraulicaQtd.value = dados.q10_mola_hidraulica_qtd || "";

    // Proteção Botoeira Emergência
    if (q10ProtecaoBotoeiraEmergenciaQtd) q10ProtecaoBotoeiraEmergenciaQtd.value = dados.q10_protecao_botoeira_emergencia_qtd || "";

    // Modelos dos campos Q10 existentes
    if (q10BotoeiraSaidaModelo) q10BotoeiraSaidaModelo.value = dados.q10_botoeira_saida_modelo || "";
    if (q10BotoeiraEmergenciaModelo) q10BotoeiraEmergenciaModelo.value = dados.q10_botoeira_emergencia_modelo || "";
    if (q10LeitorCartaoModelo) q10LeitorCartaoModelo.value = dados.q10_leitor_cartao_modelo || "";
    if (q10LeitorFacialModelo) q10LeitorFacialModelo.value = dados.q10_leitor_facial_modelo || "";
    if (q10SensorPresencaModelo) q10SensorPresencaModelo.value = dados.q10_sensor_presenca_modelo || "";
    if (q10SensorBarreiraModelo) q10SensorBarreiraModelo.value = dados.q10_sensor_barreira_modelo || "";

    if (q9Observacoes) q9Observacoes.value = dados.q9_observacoes || "";
    if (q10Observacoes) q10Observacoes.value = dados.q10_observacoes || "";

    // Quantitativo 06 – Catracas, Torniquetes e Cancelas
    if (q6Modelo) q6Modelo.value = dados.q6_modelo || "";
    if (q6Quantidade) q6Quantidade.value = dados.q6_quantidade || "";
    if (q6LeitorFacial) booleanParaSelectSimNao(q6LeitorFacial, dados.q6_leitor_facial);
    if (q6LeitorFacialQtd) q6LeitorFacialQtd.value = dados.q6_leitor_facial_qtd || "";
    if (q6SuporteLeitorFacial) booleanParaSelectSimNao(q6SuporteLeitorFacial, dados.q6_suporte_leitor_facial);
    if (q6SuporteLeitorFacialQtd) q6SuporteLeitorFacialQtd.value = dados.q6_suporte_leitor_facial_qtd || "";
    if (q6LeitorCartao) booleanParaSelectSimNao(q6LeitorCartao, dados.q6_leitor_cartao);
    if (q6LeitorCartaoQtd) q6LeitorCartaoQtd.value = dados.q6_leitor_cartao_qtd || "";
    if (q6SuporteLeitorCartao) booleanParaSelectSimNao(q6SuporteLeitorCartao, dados.q6_suporte_leitor_cartao);
    if (q6SuporteLeitorCartaoQtd) q6SuporteLeitorCartaoQtd.value = dados.q6_suporte_leitor_cartao_qtd || "";
    if (q6LicencaSoftware) booleanParaSelectSimNao(q6LicencaSoftware, dados.q6_licenca_software);
    if (q6NoBreak) booleanParaSelectSimNao(q6NoBreak, dados.q6_no_break);
    if (q6Servidor) booleanParaSelectSimNao(q6Servidor, dados.q6_servidor);
    if (q6Observacoes) q6Observacoes.value = dados.q6_observacoes || "";

    // Atualizar visibilidade dos campos condicionais Q10
    atualizarVisibilidadeQ10ServoMotor();
    atualizarVisibilidadeQ10ServoMotorQtd();
    atualizarVisibilidadeQ10SuporteEletroimaQtd();
    atualizarVisibilidadeQ10BotoeiraSaidaQtd();
    atualizarVisibilidadeQ10BotoeiraEmergenciaQtd();
    atualizarVisibilidadeQ10LeitorCartaoQtd();
    atualizarVisibilidadeQ10LeitorFacialQtd();
    atualizarVisibilidadeQ10SensorPresencaQtd();
    atualizarVisibilidadeQ10SensorBarreiraQtd();

    // Atualizar visibilidade dos campos condicionais Q10 - Modelos
    atualizarVisibilidadeQ10EletroimãFechaduraModeloQtd();
    atualizarVisibilidadeQ10MolaHidraulicaTipoQtd();
    atualizarVisibilidadeQ10BotoeiraSaidaModeloQtd();
    atualizarVisibilidadeQ10BotoeiraEmergenciaModeloQtd();
    atualizarVisibilidadeQ10LeitorCartaoModeloQtd();
    atualizarVisibilidadeQ10LeitorFacialModeloQtd();
    atualizarVisibilidadeQ10SensorPresencaModeloQtd();
    atualizarVisibilidadeQ10SensorBarreiraModeloQtd();

    // Atualizar visibilidade dos campos condicionais Q6
    atualizarVisibilidadeQ6LeitorFacialQtd();
    atualizarVisibilidadeQ6SuporteLeitorFacialQtd();
    atualizarVisibilidadeQ6LeitorCartaoQtd();
    atualizarVisibilidadeQ6SuporteLeitorCartaoQtd();

    // Imagens
    if (imgRef1) {
      imgRef1.value = dados.localizacao_imagem1_url || "";                         // URL da primeira imagem vinda da API (ou string vazia)
    }
    if (imgRef2) {
      imgRef2.value = dados.localizacao_imagem2_url || "";                         // URL da segunda imagem vinda da API (ou string vazia)
    }

    // Após preencher as URLs, garantimos que as miniaturas fiquem sincronizadas
    if (typeof atualizarThumbnailLocalizacao === "function") {                     // verifica se o helper de miniaturas está definido no escopo
      atualizarThumbnailLocalizacao(1);                                            // atualiza a miniatura da imagem 1 de acordo com o campo de URL
      atualizarThumbnailLocalizacao(2);                                            // atualiza a miniatura da imagem 2 de acordo com o campo de URL
    }

    // Pré-requisitos
    if (preTrabalhoAltura) {
      booleanParaSelectSimNao(                                              // usa helper para preencher o <select> baseado em um booleano
        preTrabalhoAltura,                                                      // referência ao <select id="servico-fora-montes-claros">
        dados.pre_trabalho_altura                                    // valor booleano vindo da API (true/false ou null)
      );
    }
    prePlataforma.value = "";
    if (prePlataforma) {                                                    // verifica se o <select> de serviço fora de Montes Claros existe
      booleanParaSelectSimNao(                                              // usa helper para preencher o <select> baseado em um booleano
        prePlataforma,                                                      // referência ao <select id="servico-fora-montes-claros">
        dados.pre_plataforma                                    // valor booleano vindo da API (true/false ou null)
      );
    }
    prePlataformaModelo.value = dados.pre_plataforma_modelo || "";
    prePlataformaDias.value = dados.pre_plataforma_dias || "";
    atualizarVisibilidadeModeloPlataforma();
    preForaHorario.checked = dados.pre_fora_horario_comercial ?? false;
    if (preForaHorario) {                                                    // verifica se o <select> de serviço fora de Montes Claros existe
      booleanParaSelectSimNao(                                              // usa helper para preencher o <select> baseado em um booleano
        preForaHorario,                                                      // referência ao <select id="servico-fora-montes-claros">
        dados.pre_fora_horario_comercial                                    // valor booleano vindo da API (true/false ou null)
      );
    }
    preVeiculoEmpresa.checked = dados.pre_veiculo_quotation_evaluation ?? false;
    if (preVeiculoEmpresa) {                                                    // verifica se o <select> de serviço fora de Montes Claros existe
      booleanParaSelectSimNao(                                              // usa helper para preencher o <select> baseado em um booleano
        preVeiculoEmpresa,                                                      // referência ao <select id="servico-fora-montes-claros">
        dados.pre_veiculo_quotation_evaluation                                    // valor booleano vindo da API (true/false ou null)
      );
    }
    preContainer.checked = dados.pre_container_materiais ?? false;
    if (preContainer) {                                                    // verifica se o <select> de serviço fora de Montes Claros existe
      booleanParaSelectSimNao(                                              // usa helper para preencher o <select> baseado em um booleano
        preContainer,                                                      // referência ao <select id="servico-fora-montes-claros">
        dados.pre_container_materiais                                    // valor booleano vindo da API (true/false ou null)
      );
    }

    // Horas - dias normais (Tabela 4)
    if (encarregadoDiasInput) encarregadoDiasInput.value = dados.encarregado_dias ?? "";                       // preenche dias de encarregado vindos da API
    if (instaladorDiasInput) instaladorDiasInput.value = dados.instalador_dias ?? "";                         // preenche dias de instalador
    if (auxiliarDiasInput) auxiliarDiasInput.value = dados.auxiliar_dias ?? "";                               // preenche dias de auxiliar
    if (tecnicoInstalacaoDiasInput) tecnicoInstalacaoDiasInput.value = dados.tecnico_de_instalacao_dias ?? ""; // preenche dias do técnico de instalação
    if (tecnicoSegurancaDiasInput) tecnicoSegurancaDiasInput.value = dados.tecnico_em_seguranca_dias ?? "";    // preenche dias do técnico em segurança

    // Horas extras por função
    if (encarregadoHoraExtraInput) encarregadoHoraExtraInput.value = dados.encarregado_hora_extra ?? "";                 // preenche horas extras do encarregado
    if (instaladorHoraExtraInput) instaladorHoraExtraInput.value = dados.instalador_hora_extra ?? "";                   // preenche horas extras do instalador
    if (auxiliarHoraExtraInput) auxiliarHoraExtraInput.value = dados.auxiliar_hora_extra ?? "";                         // preenche horas extras do auxiliar
    if (tecnicoInstalacaoHoraExtraInput) tecnicoInstalacaoHoraExtraInput.value = dados.tecnico_de_instalacao_hora_extra ?? ""; // preenche horas extras do técnico de instalação
    if (tecnicoSegurancaHoraExtraInput) tecnicoSegurancaHoraExtraInput.value = dados.tecnico_em_seguranca_hora_extra ?? "";     // preenche horas extras do técnico em segurança

    // Trabalho em domingos/feriados por função
    if (encarregadoDomingoInput) encarregadoDomingoInput.value = dados.encarregado_trabalho_domingo ?? "";                 // preenche domingos/feriados do encarregado
    if (instaladorDomingoInput) instaladorDomingoInput.value = dados.instalador_trabalho_domingo ?? "";                   // preenche domingos/feriados do instalador
    if (auxiliarDomingoInput) auxiliarDomingoInput.value = dados.auxiliar_trabalho_domingo ?? "";                         // preenche domingos/feriados do auxiliar
    if (tecnicoInstalacaoDomingoInput) tecnicoInstalacaoDomingoInput.value = dados.tecnico_de_instalacao_trabalho_domingo ?? ""; // preenche domingos/feriados do técnico de instalação
    if (tecnicoSegurancaDomingoInput) tecnicoSegurancaDomingoInput.value = dados.tecnico_em_seguranca_trabalho_domingo ?? "";   // preenche domingos/feriados do técnico em segurança

    // Prazos (cronograma e entregas)
    booleanParaSelectSimNao(cronogramaExecucaoSelect, dados.cronograma_execucao);        // converte o booleano da API para "sim"/"nao" no select de cronograma
    if (diasInstalacaoInput) diasInstalacaoInput.value = dados.dias_instalacao ?? "";    // preenche os dias previstos de instalação
    booleanParaSelectSimNao(asBuiltSelect, dados.as_built);                              // preenche o select de As Built
    if (diasEntregaRelatorioInput) diasEntregaRelatorioInput.value = dados.dias_entrega_relatorio ?? ""; // preenche o prazo de entrega do relatório
    booleanParaSelectSimNao(artSelect, dados.art);                                       // preenche o select de ART

    // Alimentação
    if (almocoQtdInput) almocoQtdInput.value = dados.almoco_qtd ?? "";   // preenche quantidade de almoços
    if (lancheQtdInput) lancheQtdInput.value = dados.lanche_qtd ?? "";   // preenche quantidade de lanches
    
    await carregarListaMateriaisInfraDoBackend(
      avaliacaoId
    ); // busca no backend a lista de materiais de infraestrutura da avaliação e preenche a tabela dinâmica correspondente

    atualizarVisibilidadeBotaoExportarPDF(); // atualiza visibilidade do botão de exportar PDF

    // Feedback visual informando que estamos em modo edição
    avaliacaoFeedbackEl.textContent =
      "Você está editando uma avaliação existente. Após alterar os campos, clique em “Salvar avaliação”."; // aviso de edição
    avaliacaoFeedbackEl.className = "form-feedback form-success"; // usa estilo de sucesso suave
  } catch (err) {
    console.error(err); // loga erro no console

    avaliacaoFeedbackEl.textContent =
      "Não foi possível carregar os dados da avaliação selecionada."; // mensagem de erro na interface
    avaliacaoFeedbackEl.className = "form-feedback form-error"; // aplica estilo de erro
  }
}

/**
 * Deixa o formulário de avaliação no modo padrão de "Nova Avaliação".
 * Limpa o id em edição e ajusta título/subtítulo.
 */
function resetarFormularioParaNovaAvaliacao() {
  avaliacaoEmEdicaoId = null; // zera o id em edição: próximo submit será um POST (criação)
  avaliacaoEmEdicaoCodigo = null; // zera também o código da avaliação
  rascunhoEmEdicaoId = null;  // zera também o id do rascunho vinculado, iniciando uma nova avaliação "do zero"

  if (rascunhoIdInput) { // se o campo oculto existir
    rascunhoIdInput.value = ""; // limpa o id de rascunho ao iniciar uma nova avaliação
  }

  if (formTituloEl) {
    formTituloEl.textContent = "Nova Avaliação"; // título padrão exibido na tela
  }

  if (formSubtituloEl) {
    formSubtituloEl.textContent =
      "Preencha os dados abaixo para registrar uma nova avaliação técnica."; // texto padrão
  }

  // Flags gerais
  if (servicoForaMC) servicoForaMC.value = "";             // desmarca a opção "serviço fora de Montes Claros"
  if (servicoIntermediario) servicoIntermediario.value = ""; // desmarca a opção de serviço intermediário

  // Campos comerciais (Pedido de Compra e Número da Proposta)
  const pedidoCompraInput = document.getElementById("pedido-compra");
  const numeroPropostaInput = document.getElementById("numero-proposta");
  if (pedidoCompraInput) pedidoCompraInput.value = "";      // limpa pedido de compra
  if (numeroPropostaInput) numeroPropostaInput.value = "";  // limpa número da proposta
  atualizarPermissaoCamposComerciais();                     // esconde campos comerciais (status será "aberto")

  // Campo de cliente (select + "Outro")
  if (clienteNomeInput) {                                       // se o select de cliente existir
    clienteNomeInput.value = "";                                // limpa a seleção de cliente
  }
  if (clienteNomeOutroInput) {                                  // se o input de "Outro" existir
    clienteNomeOutroInput.value = "";                           // limpa qualquer texto digitado
  }
  if (clienteOutroWrapper) {                                    // se o wrapper do campo "Outro" existir
    clienteOutroWrapper.classList.add("invisible-keep-space");                // garante que o campo "Outro" fique oculto no reset
  }

  // Quantitativo 01 – Patch Panel / Cabeamento                         // comentário da seção de reset
  if (q1Categoria) q1Categoria.value = "";                              // limpa categoria do cabeamento
  if (q1Blindado) q1Blindado.value = "";                                // reseta select de cabeamento blindado
  if (q1NovoPatch) q1NovoPatch.value = "";                              // reseta select "Necessita novo patch panel?"
  if (q1IncluirGuia) q1IncluirGuia.value = "";                          // reseta select "Incluir guia de cabos?"
  if (q1QtdGuiasCabos) q1QtdGuiasCabos.value = "";                 // limpa quantidade de guias de cabos
  if (q1QtdGuiasCabosWrapper) {                                    // se o wrapper existir
    q1QtdGuiasCabosWrapper.classList.add("invisible-keep-space");                // garante que o campo fique oculto após o reset
  }
  if (q1QtdPontosRede) q1QtdPontosRede.value = "";                      // limpa quantidade de pontos de rede
  if (q1QtdCabos) q1QtdCabos.value = "";                                // limpa quantidade de cabos
  if (q1QtdPortasPP) q1QtdPortasPP.value = "";                          // limpa quantidade de portas no patch panel
  if (q1QtdPatchCords) q1QtdPatchCords.value = "";                      // limpa quantidade de patch cords
  if (q1PatchCordsModelo) q1PatchCordsModelo.value = "";           // limpa modelo dos patch cords
  if (q1PatchCordsCor) q1PatchCordsCor.value = "";                 // limpa cor dos patch cords
  if (q1MarcaCab) q1MarcaCab.value = "";                                // limpa o select de marca do cabeamento
  if (q1MarcaCabOutroInput) q1MarcaCabOutroInput.value = "";            // limpa o texto do campo "Outro" de marca
  if (q1MarcaCabOutroWrapper) {                                         // se o wrapper do campo "Outro" de marca existir
    q1MarcaCabOutroWrapper.classList.add("invisible-keep-space");                     // garante que o campo "Outro" de marca fique oculto no reset
  }
  if (q1ModeloPatchPanel) q1ModeloPatchPanel.value = "";           // reseta o select de modelo do patch panel
  if (q1ModeloPatchPanelOutroInput) q1ModeloPatchPanelOutroInput.value = ""; // limpa o texto de "Outro" do modelo
  if (q1ModeloPatchPanelWrapper) q1ModeloPatchPanelWrapper.classList.add("invisible-keep-space");  // esconde a linha e modelo de patch panel
  if (q1ModeloPatchPanelOutroWrapper) {                            // se o wrapper de "Outro" existir
    q1ModeloPatchPanelOutroWrapper.classList.add("invisible-keep-space");        // garante que o campo de "Outro" esteja oculto
  }
  
  // Quantitativo 02 – Switch
  //if (q2NovoSwitch) q2NovoSwitch.checked = false;
  if (q2NovoSwitch) q2NovoSwitch.value = "";                      // reseta "Necessita novo switch?"
  if (q2FornecedorSwitch) q2FornecedorSwitch.value = "";          // limpa seleção de fornecedor do switch
  if (q2FornecedorSwitchWrapper) {                                // se o wrapper de fornecedor existir
    q2FornecedorSwitchWrapper.classList.add("invisible-keep-space");            // garante que o campo de fornecedor fique oculto após o reset
  }

  if (q2ObsSwitch) q2ObsSwitch.value = "";

  // Quantitativo 03 – Fibra Óptica
  if (q3TipoFibra) q3TipoFibra.value = "";
  if (q3QtdFibrasPorCabo) q3QtdFibrasPorCabo.value = "";
  if (q3TipoConector) q3TipoConector.value = "";
  if (q3NovoDio) q3NovoDio.value = "";                                             // limpa o select "Necessário novo DIO?"
  if (q3ModeloDio) q3ModeloDio.value = "";                                         // limpa o modelo do DIO
  if (q3ModeloDioWrapper) {                                                        // se o wrapper existir
    q3ModeloDioWrapper.classList.add("invisible-keep-space");                                    // garante que o campo de modelo fique oculto após o reset
  }
  if (q3CaixaTerminacao) q3CaixaTerminacao.checked = false;
  if (q3CaixaEmenda) q3CaixaEmenda.checked = false;
  if (q3QtdCabos) q3QtdCabos.value = "";
  if (q3TamanhoTotal) q3TamanhoTotal.value = "";
  if (q3QtdCordoesOpticos) q3QtdCordoesOpticos.value = "";
  if (q3Obs) q3Obs.value = "";
  if (q3MarcaCabOptico) q3MarcaCabOptico.value = "";                           // limpa a seleção de marca do cabo óptico
  if (q3MarcaCabOpticoOutroInput) q3MarcaCabOpticoOutroInput.value = "";       // limpa o texto do campo "Outro" de marca óptica
  if (q3MarcaCabOpticoOutroWrapper) {                                          // se o wrapper do campo "Outro" existir
    q3MarcaCabOpticoOutroWrapper.classList.add("invisible-keep-space");                      // garante que o campo "Outro" fique oculto após o reset
  }

  // Quantitativo 04 – Equipamentos
  if (q4Camera) q4Camera.value = "";                                     // reseta select de flag "Câmera?"
  if (q4NvrDvr) q4NvrDvr.value = "";                                     // reseta select de flag "NVR/DVR?"
  if (q4CameraNova) q4CameraNova.value = "";                             // reseta select "Câmera nova/realocação?"
  if (q4CameraNovaWrapper) q4CameraNovaWrapper.classList.add("invisible-keep-space");
  if (q4CameraFornecedor) q4CameraFornecedor.value = "";                 // reseta fornecedor da câmera
  if (q4CameraModelo) q4CameraModelo.value = "";                         // limpa modelo da câmera
  if (q4CameraModeloWrapper) q4CameraModeloWrapper.classList.add("invisible-keep-space");
  if (q4CameraQtd) q4CameraQtd.value = "";                               // limpa quantidade de câmeras
  if (q4CameraQtdWrapper) q4CameraQtdWrapper.classList.add("invisible-keep-space");
  if (q4NvrDvrModelo) q4NvrDvrModelo.value = "";                         // limpa modelo do NVR/DVR
  if(q4NvrDvrModeloWrapper) q4NvrDvrModeloWrapper.classList.add("invisible-keep-space");

  // Quantitativo 05 – Infraestrutura
  if (q5NovaEletrocalha) q5NovaEletrocalha.value = "";                // reseta select de nova eletrocalha
  if (q5NovoEletroduto) q5NovoEletroduto.value = "";                  // reseta select de novo eletroduto
  if (q5NovoRack) q5NovoRack.value = "";                              // reseta select de novo rack
  if (q5InstalacaoEletrica) q5InstalacaoEletrica.value = "";          // reseta select de instalação elétrica
  if (q5Nobreak) q5Nobreak.value = "";                                // reseta select de nobreak
  if (q5Serralheria) q5Serralheria.value = "";                        // reseta select de serralheria

  if (q5EletrocalhaModelo) q5EletrocalhaModelo.value = "";            // limpa modelo da eletrocalha
  if (q5EletrocalhaQtd) q5EletrocalhaQtd.value = "";                  // limpa quantidade de eletrocalhas
  if (q5EletrodutoModelo) q5EletrodutoModelo.value = "";              // limpa modelo do eletroduto
  if (q5EletrodutoQtd) q5EletrodutoQtd.value = "";                    // limpa quantidade de eletrodutos
  if (q5RackModelo) q5RackModelo.value = "";                          // limpa modelo do rack
  if (q5RackQtd) q5RackQtd.value = "";                                // limpa quantidade de racks
  if (q5NobreakModelo) q5NobreakModelo.value = "";                    // limpa modelo do nobreak
  if (q5NobreakQtd) q5NobreakQtd.value = "";                          // limpa quantidade de nobreaks
  if (q5SerralheriaDescricao) q5SerralheriaDescricao.value = "";      // limpa descrição da serralheria
  if (q5InstalacaoEletricaObs) q5InstalacaoEletricaObs.value = "";    // limpa observações da instalação elétrica

  // Quantitativo 09 - Análise de Painel de Automação (Controle de Acesso)
  if (q9TensaoFonte) q9TensaoFonte.value = "";
  if (q9TensaoFonteOutro) q9TensaoFonteOutro.value = "";
  if (q9NovoCabeamento) q9NovoCabeamento.value = "";
  if (q9TipoCabeamento) q9TipoCabeamento.value = "";
  if (q9TipoCabeamentoOutro) q9TipoCabeamentoOutro.value = "";
  if (q9QuantidadeMetros) q9QuantidadeMetros.value = "";
  if (q9MateriaisPainelTbody) limparTabelaQ9MateriaisPainel();

  // Quantitativo 10 - Portas (Controle de Acesso)
  if (q10TipoPorta) q10TipoPorta.value = "";
  if (q10ServoMotor) q10ServoMotor.value = "";
  if (q10ServoMotorQtd) q10ServoMotorQtd.value = "";
  if (q10PontoEletricoNovo) q10PontoEletricoNovo.value = "";
  if (q10SuporteEletroima) q10SuporteEletroima.value = "";
  if (q10SuporteEletroimaQtd) q10SuporteEletroimaQtd.value = "";
  if (q10BotoeiraSaida) q10BotoeiraSaida.value = "";
  if (q10BotoeiraSaidaQtd) q10BotoeiraSaidaQtd.value = "";
  if (q10BotoeiraEmergencia) q10BotoeiraEmergencia.value = "";
  if (q10BotoeiraEmergenciaQtd) q10BotoeiraEmergenciaQtd.value = "";
  if (q10LeitorCartao) q10LeitorCartao.value = "";
  if (q10LeitorCartaoQtd) q10LeitorCartaoQtd.value = "";
  if (q10LeitorFacial) q10LeitorFacial.value = "";
  if (q10LeitorFacialQtd) q10LeitorFacialQtd.value = "";
  if (q10SensorPresenca) q10SensorPresenca.value = "";
  if (q10SensorPresencaQtd) q10SensorPresencaQtd.value = "";
  if (q10SensorBarreira) q10SensorBarreira.value = "";
  if (q10SensorBarreiraQtd) q10SensorBarreiraQtd.value = "";

  if (infraListaMateriaisTbody) {                    // verifica se o corpo da tabela de materiais de infraestrutura existe
    limparTabelaMateriaisInfra();                    // limpa a lista de materiais, deixando apenas uma linha vazia pronta para uso
  }
  
  // Imagens - Localização (blocos dinâmicos)
  if (window.localizacaoImagens && typeof window.localizacaoImagens.resetFromEmpty === "function") {
    window.localizacaoImagens.resetFromEmpty();
  }

  // Pré-requisitos
  if (preTrabalhoAltura) preTrabalhoAltura.value = "";                             // reseta o select de trabalho em altura
  if (prePlataforma) prePlataforma.value = "";
  if (prePlataformaModelo) {
    prePlataformaModelo.classList.add("invisible-keep-space");
  }
  if (prePlataformaDias) prePlataformaDias.value = "";
  if (preForaHorario) preForaHorario.value = "";
  if (preVeiculoEmpresa) preVeiculoEmpresa.value = "";
  if (preContainer) preContainer.value = "";

  // Horas - dias normais (Tabela 4)
  if (encarregadoDiasInput) encarregadoDiasInput.value = "";                 // limpa dias de encarregado
  if (instaladorDiasInput) instaladorDiasInput.value = "";                   // limpa dias de instalador
  if (auxiliarDiasInput) auxiliarDiasInput.value = "";                       // limpa dias de auxiliar
  if (tecnicoInstalacaoDiasInput) tecnicoInstalacaoDiasInput.value = "";     // limpa dias do técnico de instalação
  if (tecnicoSegurancaDiasInput) tecnicoSegurancaDiasInput.value = "";       // limpa dias do técnico em segurança

  // Horas extras por função
  if (encarregadoHoraExtraInput) encarregadoHoraExtraInput.value = "";                 // limpa horas extras do encarregado
  if (instaladorHoraExtraInput) instaladorHoraExtraInput.value = "";                   // limpa horas extras do instalador
  if (auxiliarHoraExtraInput) auxiliarHoraExtraInput.value = "";                       // limpa horas extras do auxiliar
  if (tecnicoInstalacaoHoraExtraInput) tecnicoInstalacaoHoraExtraInput.value = "";     // limpa horas extras do técnico de instalação
  if (tecnicoSegurancaHoraExtraInput) tecnicoSegurancaHoraExtraInput.value = "";       // limpa horas extras do técnico em segurança

  // Trabalho em domingos/feriados por função
  if (encarregadoDomingoInput) encarregadoDomingoInput.value = "";                 // limpa domingos/feriados do encarregado
  if (instaladorDomingoInput) instaladorDomingoInput.value = "";                   // limpa domingos/feriados do instalador
  if (auxiliarDomingoInput) auxiliarDomingoInput.value = "";                       // limpa domingos/feriados do auxiliar
  if (tecnicoInstalacaoDomingoInput) tecnicoInstalacaoDomingoInput.value = "";     // limpa domingos/feriados do técnico de instalação
  if (tecnicoSegurancaDomingoInput) tecnicoSegurancaDomingoInput.value = "";       // limpa domingos/feriados do técnico em segurança

  // Prazos
  if (cronogramaExecucaoSelect) cronogramaExecucaoSelect.value = "";           // reseta o select de cronograma
  if (diasInstalacaoInput) diasInstalacaoInput.value = "";                     // limpa dias de instalação
  if (asBuiltSelect) asBuiltSelect.value = "";                                  // reseta o select de As Built
  if (diasEntregaRelatorioInput) diasEntregaRelatorioInput.value = "";         // limpa prazo de entrega do relatório
  if (artSelect) artSelect.value = "";                                          // reseta o select de ART

  // Alimentação
  if (almocoQtdInput) almocoQtdInput.value = "";                                // limpa quantidade de almoços
  if (lancheQtdInput) lancheQtdInput.value = "";                                // limpa quantidade de lanches

  atualizarVisibilidadeBotaoExportarPDF(); // atualiza visibilidade do botão de exportar PDF

}

// Converte um <select> com opções "sim" / "nao" em um boolean ou null
function selectSimNaoParaBoolean(selectEl) {                     // recebe a referência do elemento select
  if (!selectEl) return null;                                    // se o elemento não existir, devolve null (mais seguro)
  const valor = selectEl.value;                                  // lê o valor selecionado no select

  if (valor === "sim") return true;                              // se for "sim", devolve true
  if (valor === "nao") return false;                             // se for "nao", devolve false
  return null;                                                   // se estiver vazio ou outro valor, devolve null
}

// Preenche um <select> "sim" / "nao" a partir de um boolean (true/false/null)
function booleanParaSelectSimNao(selectEl, valor) {              // recebe o select e o valor booleano vindo da API
  if (!selectEl) return;                                         // se o elemento não existir, não faz nada
  if (valor === true) {                                          // se o valor for true...
    selectEl.value = "sim";                                      // ...seleciona "sim"
  } else if (valor === false) {                                  // se o valor for false...
    selectEl.value = "nao";                                      // ...seleciona "nao"
  } else {                                                       // se for null/undefined
    selectEl.value = "";                                         // deixa o select sem seleção
  }
}

// Função genérica para atualizar a visibilidade de campos "Outro"        // comentário explicando a finalidade da função
// baseada em um <select> que possui uma opção com valor "outro"          // esclarece a regra de negócio usada para mostrar/esconder
function atualizarVisibilidadeCampoOutro(                                  // declara a função genérica que será reutilizada
  selectElement,                                                           // parâmetro: elemento <select> que controla a escolha
  wrapperElement,                                                          // parâmetro: wrapper (.form-group/.form-row) do campo "Outro"
  inputOutroElement                                                        // parâmetro: input de texto associado à opção "outro"
) {
  if (!selectElement || !wrapperElement) return;                           // se não existir select ou wrapper, sai sem fazer nada

  const valorSelecionado = selectElement.value;                            // obtém o valor atualmente selecionado no <select>

  if (valorSelecionado === "outro") {                                      // se o valor selecionado for exatamente "outro"
    wrapperElement.classList.remove("hidden");                             // remove a classe "hidden" para exibir o campo "Outro"
  } else {                                                                 // para qualquer outro valor (inclusive vazio)
    wrapperElement.classList.add("hidden");                                // adiciona a classe "hidden" para esconder o campo "Outro"

    if (inputOutroElement) {                                               // se o input de texto de "Outro" foi informado
      inputOutroElement.value = "";                                        // limpa o texto digitado anteriormente para evitar lixo
    }                                                                      // fim do if inputOutroElement
  }                                                                        // fim do if/else de valorSelecionado
}                                                                          // fim da função atualizarVisibilidadeCampoOutro

// Atualiza a visibilidade do campo
function atualizarVisibilidadeNvrdvr() {                           // declara a função que controla o campo de fornecedor
  if (!q4NvrDvr || !q4NvrDvrModeloWrapper) return;                   // se não houver o select de novo switch ou o wrapper, sai sem fazer nada

  const valor = q4NvrDvr.value;                                // lê o valor atual do select "Necessita novo switch?"

  if (valor === "sim") {                                           // se o usuário marcou "Sim"
    q4NvrDvrModeloWrapper.classList.remove("invisible-keep-space");                    // mostra o campo "Fornecedor do switch"
  } else {                                                                   // se marcou "Não" ou deixou vazio
    q4NvrDvrModeloWrapper.classList.add("invisible-keep-space");                       // esconde o campo "Fornecedor do switch"
    if (q4NvrDvrModelo) {                                                // se o select de fornecedor existir
      q4NvrDvrModelo.value = "";                                         // limpa a seleção de fornecedor ao esconder o campo
    }
  }
}

function atualizarVisibilidadeCamera(){

  if (!q4Camera || !q4CameraNovaWrapper || !q4CameraModeloWrapper || !q4CameraQtdWrapper) return;                   // se não houver o select de novo switch ou o wrapper, sai sem fazer nada

  const valor = q4Camera.value;                                // lê o valor atual do select "Necessita novo switch?"

  if (valor === "sim") {                                           // se o usuário marcou "Sim"
    q4CameraModeloWrapper.classList.remove("invisible-keep-space");                    // mostra o campo "Fornecedor do switch"
    q4CameraQtdWrapper.classList.remove("invisible-keep-space");                    // mostra o campo "Fornecedor do switch"
    q4CameraNovaWrapper.classList.add("invisible-keep-space")
    if (q4CameraNova){
      q4CameraNova.value = "";
    }
  } else {                                                                   // se marcou "Não" ou deixou vazio
    q4CameraNovaWrapper.classList.remove("invisible-keep-space")
    q4CameraModeloWrapper.classList.add("invisible-keep-space");                       // esconde o campo "Fornecedor do switch"
    q4CameraQtdWrapper.classList.add("invisible-keep-space");
    if (q4CameraModeloWrapper) {                                                // se o select de fornecedor existir
      q4CameraModelo.value = "";                                         // limpa a seleção de fornecedor ao esconder o campo
    }
    if (q4CameraQtdWrapper) {                                                // se o select de fornecedor existir
      q4CameraQtd.value = "";                                         // limpa a seleção de fornecedor ao esconder o campo
    }
        
  }
}

function atualizarVisibilidadeFornecedorSwitch() {                           // declara a função que controla o campo de fornecedor
  if (!q2NovoSwitch || !q2FornecedorSwitchWrapper) return;                   // se não houver o select de novo switch ou o wrapper, sai sem fazer nada

  const valorNovoSwitch = q2NovoSwitch.value;                                // lê o valor atual do select "Necessita novo switch?"

  if (valorNovoSwitch === "sim") {                                           // se o usuário marcou "Sim"
    q2FornecedorSwitchWrapper.classList.remove("invisible-keep-space");                    // mostra o campo "Fornecedor do switch"
  } else {                                                                   // se marcou "Não" ou deixou vazio
    q2FornecedorSwitchWrapper.classList.add("invisible-keep-space");                       // esconde o campo "Fornecedor do switch"
    if (q2FornecedorSwitch) {                                                // se o select de fornecedor existir
      q2FornecedorSwitch.value = "";                                         // limpa a seleção de fornecedor ao esconder o campo
    }
  }
}

// Atualiza a visibilidade do campo "Outro" do cliente usando a função genérica // comentário descrevendo a função específica
function atualizarVisibilidadeClienteOutro() {                             // declara a função específica para o cliente
  // atualizarVisibilidadeCampoOutro(                                         // chama a função genérica de visibilidade
  //   clienteNomeInput,                                                      // passa o <select> de cliente como primeiro parâmetro
  //   clienteOutroWrapper,                                                   // passa o wrapper do campo "Outro" de cliente
  //   clienteNomeOutroInput                                                  // passa o input de texto para "Outro" (nome do cliente)
  // );                                                                    // fim da chamada à função genérica
  if (!clienteNomeInput || !clienteOutroWrapper) return;                                 // se não houver select ou wrapper, sai sem fazer nada

  const valorNovoCliente = clienteNomeInput.value;                                          // lê o valor selecionado em "Necessário novo DIO?"

  if (valorNovoCliente === "outro") {                                                  // se o usuário marcou "Sim"
    clienteOutroWrapper.classList.remove("invisible-keep-space");                               // mostra o campo "Modelo do DIO"
  } else {                                                                       // se marcou "Não" ou deixou em branco
    clienteOutroWrapper.classList.add("invisible-keep-space");                                  // esconde o campo de modelo
    if (clienteNomeOutroInput) {                                                           // se o input de modelo existir
      clienteNomeOutroInput.value = "";                                                    // limpa qualquer texto digitado
    }
  }

}                                                                          // fim da função atualizarVisibilidadeClienteOutro

// Atualiza a visibilidade do campo "Qtd. de guias de cabos"                     // comentário explicando a função
function atualizarVisibilidadeQtdGuiasCabos() {                                  // declara a função responsável por mostrar/esconder a quantidade
  if (!q1IncluirGuia || !q1QtdGuiasCabosWrapper) return;                         // se não houver select ou wrapper, sai sem fazer nada

  const valorIncluir = q1IncluirGuia.value;                                      // lê o valor atual do select "Incluir guia de cabos?"

  if (valorIncluir === "sim") {                                                  // se o usuário marcou "Sim"
    q1QtdGuiasCabosWrapper.classList.remove("invisible-keep-space");                           // mostra o bloco de quantidade de guias de cabos
  } else {                                                                       // se marcou "Não" ou deixou vazio
    q1QtdGuiasCabosWrapper.classList.add("invisible-keep-space");                              // esconde o bloco de quantidade de guias de cabos
    if (q1QtdGuiasCabos) {                                                       // se o input numérico existir
      q1QtdGuiasCabos.value = "";                                                // limpa o valor digitado, para não enviar lixo para a API
    }
  }
}

// Atualiza a visibilidade da linha de modelo de patch panel quando o usuário escolhe se precisa de novo patch panel
function atualizarVisibilidadeModeloPatchPanel() {               // declara a função responsável por mostrar/esconder a linha de modelo do patch panel
  if (!q1ModeloPatchPanelWrapper || !q1NovoPatch) return;            // se não existir a linha de modelo ou o select "Necessita novo patch panel?", sai sem fazer nada

  const valor = q1NovoPatch.value;                               // lê o valor atual do select "Necessita novo patch panel?"

  if (valor === "sim") {                                         // se o usuário marcou que precisa de novo patch panel
    q1ModeloPatchPanelWrapper.classList.remove("invisible-keep-space");            // mostra a linha com o select de modelo de patch panel
  } else {                                                       // se marcou "não" ou deixou em branco
    q1ModeloPatchPanelWrapper.classList.add("invisible-keep-space");               // esconde a linha de modelo de patch panel
    if (q1ModeloPatchPanel) q1ModeloPatchPanel.value = "";       // limpa o select de modelo, se existir
    if (q1ModeloPatchPanelOutroInput) {                          // se existir o input de "Outro" para o modelo
      q1ModeloPatchPanelOutroInput.value = "";                   // limpa o texto digitado anteriormente
    }
    if (q1ModeloPatchPanelOutroWrapper) {                        // se existir o wrapper do campo "Outro"
      q1ModeloPatchPanelOutroWrapper.classList.add("invisible-keep-space");    // garante que o campo "Outro" fique oculto
    }
  }
}                                                                // fim da função atualizarVisibilidadeModeloPatchPanel

function atualizarVisibilidadeModeloPlataforma() {
  if (!prePlataforma || !prePlataformaModelo) return;

  const valor = prePlataforma.value;                       

  if (valor === "sim") {                                 
    prePlataformaModelo.classList.remove("invisible-keep-space");
  } else {                                                      
    prePlataformaModelo.classList.add("invisible-keep-space");
    if (prePlataformaModelo) prePlataformaModelo.value = "";       
  }
}    

// Atualiza a visibilidade do campo "Outro" do modelo de patch panel
function atualizarVisibilidadeModeloPatchPanelOutro() {          // declara a função responsável por mostrar/esconder o campo "Outro" do modelo
  if (!q1ModeloPatchPanel || !q1ModeloPatchPanelOutroWrapper) return; // se não houver o select de modelo ou o wrapper do campo "Outro", sai

  const valorModelo = q1ModeloPatchPanel.value;                  // lê o valor atualmente selecionado no select de modelo
  if (valorModelo === "outro") {                                 // se o usuário escolheu a opção "Outro"
    q1ModeloPatchPanelOutroWrapper.classList.remove("invisible-keep-space");   // mostra o grupo de campo de texto para descrever o modelo
  } else {                                                       // se escolheu qualquer outra opção
    q1ModeloPatchPanelOutroWrapper.classList.add("invisible-keep-space");      // esconde o campo "Outro"
    if (q1ModeloPatchPanelOutroInput) {                          // se o input de "Outro" existir
      q1ModeloPatchPanelOutroInput.value = "";                   // limpa o texto digitado anteriormente
    }
  }
}                                                                // fim da função atualizarVisibilidadeModeloPatchPanelOutro                                                                    // fim da função atualizarVisibilidadeModeloPatchPanelOutro

// Atualiza a visibilidade do campo "Outro" para a marca do cabeamento UTP  // comentário explicando o objetivo da função
function atualizarVisibilidadeMarcaCabOutro() {                            // declara a função específica para marca do cabeamento                                                                      // fim da chamada à função genérica
  if (!q1MarcaCab || !q1MarcaCabOutroWrapper) return; // se não houver o select de modelo ou o wrapper do campo "Outro", sai

  const valor = q1MarcaCab.value;                  // lê o valor atualmente selecionado no select de modelo
  if (valor === "outro") {                                 // se o usuário escolheu a opção "Outro"
    q1MarcaCabOutroWrapper.classList.remove("invisible-keep-space");   // mostra o grupo de campo de texto para descrever o modelo
  } else {                                                       // se escolheu qualquer outra opção
    q1MarcaCabOutroWrapper.classList.add("invisible-keep-space");      // esconde o campo "Outro"
    if (q1MarcaCabOutroInput) {                          // se o input de "Outro" existir
      q1MarcaCabOutroInput.value = "";                   // limpa o texto digitado anteriormente
    }
  }
}                                                                          // fim da função atualizarVisibilidadeMarcaCabOutro

// Atualiza a visibilidade do campo "Outro" para a marca do cabo óptico      // explica a finalidade da função
function atualizarVisibilidadeMarcaCaboOpticoOutro() {                       // declara a função específica para marca de cabo óptico                                                                    // fim da chamada à função genérica

  if (!q3MarcaCabOptico || !q3MarcaCabOpticoOutroWrapper) return;                                 // se não houver select ou wrapper, sai sem fazer nada

  const valor = q3MarcaCabOptico.value;                                          // lê o valor selecionado em "Necessário novo DIO?"

  if (valor === "outro") {                                                  // se o usuário marcou "Sim"
    q3MarcaCabOpticoOutroWrapper.classList.remove("invisible-keep-space");                               // mostra o campo "Modelo do DIO"
  } else {                                                                       // se marcou "Não" ou deixou em branco
    q3MarcaCabOpticoOutroWrapper.classList.add("invisible-keep-space");                                  // esconde o campo de modelo
    if (q3MarcaCabOpticoOutroInput) {                                                           // se o input de modelo existir
      q3MarcaCabOpticoOutroInput.value = "";                                                    // limpa qualquer texto digitado
    }
  }

}

// Atualiza a visibilidade do campo "Modelo do DIO"                               // explica a função
function atualizarVisibilidadeModeloDio() {                                      // declara a função responsável pelo modelo do DIO
  if (!q3NovoDio || !q3ModeloDioWrapper) return;                                 // se não houver select ou wrapper, sai sem fazer nada

  const valorNovoDio = q3NovoDio.value;                                          // lê o valor selecionado em "Necessário novo DIO?"

  if (valorNovoDio === "sim") {                                                  // se o usuário marcou "Sim"
    q3ModeloDioWrapper.classList.remove("invisible-keep-space");                               // mostra o campo "Modelo do DIO"
  } else {                                                                       // se marcou "Não" ou deixou em branco
    q3ModeloDioWrapper.classList.add("invisible-keep-space");                                  // esconde o campo de modelo
    if (q3ModeloDio) {                                                           // se o input de modelo existir
      q3ModeloDio.value = "";                                                    // limpa qualquer texto digitado
    }
  }
}

// Converte o valor de um <input type="number"> em inteiro ou null
function intOrNullFromInput(inputEl) {                      // recebe o elemento de input numérico
  if (!inputEl) return null;                                // se não existir (ID errado, por ex.), devolve null
  const raw = (inputEl.value || "").trim();                 // lê o valor do input como string e remove espaços

  if (raw === "") return null;                              // se estiver vazio, devolve null (para o backend virar None)

  const parsed = parseInt(raw, 10);                         // tenta converter para inteiro na base 10
  if (Number.isNaN(parsed)) {                               // se a conversão falhar...
    return null;                                            // devolve null (em vez de mandar lixo para a API)
  }

  return parsed;                                            // se deu certo, devolve o número inteiro
}

// Converte o valor de um <input type="number"> em float ou null
function floatOrNullFromInput(inputEl) {                    // recebe o input que deve virar número decimal
  if (!inputEl) return null;                                // se não existir, devolve null
  const raw = (inputEl.value || "").trim();                 // lê string do input

  if (raw === "") return null;                              // campo vazio => null

  const parsed = parseFloat(raw.replace(",", "."));         // converte para float (troca vírgula por ponto, se o navegador permitir)
  if (Number.isNaN(parsed)) {                               // se não for um número válido...
    return null;                                            // devolve null
  }

  return parsed;                                            // devolve o número decimal válido
}
//tipo_formulario
/**
 * Aplica visibilidade das seções de formulário com base no tipo selecionado.
 * Usa configuração centralizada (FORM_TYPE_CONFIG) para fácil extensibilidade.
 *
 * Tipos suportados: utp_fibra, cameras, controle_acesso
 * Aceita valores legados (ex: "redes" → utp_fibra)
 */
function aplicarVisibilidadeTipoFormulario(tipo) {
  const tipoNormalizado = normalizarTipoFormulario(tipo);
  const config = FORM_TYPE_CONFIG[tipoNormalizado];

  if (!config) {
    console.warn(`Tipo de formulário desconhecido: ${tipo}. Usando padrão utp_fibra.`);
    aplicarVisibilidadeTipoFormulario("utp_fibra");
    return;
  }

  // Atualiza o dropdown visual (se existir)
  if (tipoFormularioSelect) {
    tipoFormularioSelect.value = tipoNormalizado;
  }

  // Atualiza o hidden input (para compatibilidade com código existente)
  if (tipoFormularioInput) {
    tipoFormularioInput.value = tipoNormalizado;
  }

  // Aplica visibilidade usando a configuração
  // Mostra as seções visíveis para este tipo
  config.visibleSections.forEach(className => {
    const blocos = document.querySelectorAll(`.${className}`);
    blocos.forEach(bloco => bloco.classList.remove("hidden"));
  });

  // Esconde as seções de outros tipos
  config.hiddenSections.forEach(className => {
    const blocos = document.querySelectorAll(`.${className}`);
    blocos.forEach(bloco => bloco.classList.add("hidden"));
  });
}

//tipo_formulario

/**
 * Coleta o estado atual do formulário de avaliação e monta um objeto de rascunho.
 * O objetivo é conseguir restaurar depois exatamente o que o usuário digitou.
 */
function coletarEstadoFormularioComoRascunho() {
  if (!formAvaliacao) { // se o formulário não existir na página
    return null; // não há o que coletar, devolve null
  }

  const campos = formAvaliacao.querySelectorAll("input, select, textarea"); // seleciona todos os campos de entrada do formulário
  const valores = {}; // objeto que guardará os valores indexados pelo id de cada campo

  campos.forEach((campo) => { // percorre cada campo encontrado na NodeList
    if (!campo.id) { // se o campo não tiver um id definido
      return; // ignora este campo, pois não teremos como mapeá-lo depois
    }

    if (campo.type === "checkbox") { // se o campo for um checkbox
      valores[campo.id] = campo.checked; // armazena um booleano indicando se o checkbox está marcado
      return; // segue para o próximo campo da lista
    }

    valores[campo.id] = campo.value; // para inputs de texto, selects e textareas, salva o valor textual do campo

  });

  if (formularioRascunhoEstaVazio(valores)) {
    return null;
  }

  const tipoFormularioAtual = tipoFormularioInput // pega o input hidden que guarda o tipo de formulário
    ? (tipoFormularioInput.value || "utp_fibra") // usa o valor atual ou "utp_fibra" como padrão se estiver vazio
    : "utp_fibra"; // se por algum motivo o hidden não existir, assume "utp_fibra" como valor padrão

  let rotuloCliente = "Cliente não informado"; // rótulo padrão caso nenhum cliente esteja preenchido

  const listaMateriaisInfra = coletarListaMateriaisInfraDoFormulario(); // coleta a lista de materiais de infraestrutura a partir da tabela dinâmica do formulário

  if (clienteNomeInput) { // se o select de cliente existir
    const valorSelect = clienteNomeInput.value || ""; // lê o valor selecionado no combo de cliente

    if (valorSelect === "outro") { // se o usuário escolheu a opção "Outro"
      const textoOutro =
        clienteNomeOutroInput && clienteNomeOutroInput.value // verifica se o input de "Outro" existe e tem valor
          ? clienteNomeOutroInput.value.trim() // remove espaços extras do texto digitado
          : ""; // caso não tenha valor, usa string vazia

      if (textoOutro) { // se o usuário realmente digitou algo no campo "Outro"
        rotuloCliente = textoOutro; // usa o texto digitado como rótulo amigável do rascunho
      }
    } else if (valorSelect) { // se alguma opção fixa foi selecionada no combo
      rotuloCliente = valorSelect; // usa diretamente o valor do select como rótulo
    }
  }

  // window.alert("id: " + rascunhoEmEdicaoId + " ; " 
  //   + "tipo_formulario: " + tipoFormularioAtual + " ; "
  //   + "rotulo: " + rotuloCliente + " ; "
  //   + "form_values: " + valores + " ; "
  //   + "avaliacao_id: " + avaliacaoEmEdicaoId + " ; ");
  // Descobre qual id de rascunho deve ser usado.
  // Primeiro tentamos usar a variável global rascunhoEmEdicaoId.
  // Se por algum motivo ela estiver vazia, usamos o dataset do formulário,
  // que é atualizado sempre que um rascunho é carregado ou salvo.
  // let idRascunhoAtual = rascunhoEmEdicaoId || null; // usa o valor atual da variável global, se existir

  // if ((!idRascunhoAtual || idRascunhoAtual === "null") && formAvaliacao && formAvaliacao.dataset) { // se não houver id válido na variável global, tenta buscar no dataset do formulário
  //   const idDoDataset = formAvaliacao.dataset.rascunhoId || ""; // lê o atributo data-rascunho-id armazenado no formulário
  //   if (idDoDataset) { // se existir algum valor preenchido no dataset
  //     idRascunhoAtual = idDoDataset; // passa a usar este valor como id do rascunho atual
  //   }
  // }

  // Descobre o id do rascunho atual.
  // 1) Tenta ler do input hidden rascunho-id (fonte principal).
  // 2) Se estiver vazio, cai para a variável global rascunhoEmEdicaoId.
  // 3) Se ainda assim não houver id, gera um novo id "draft-<timestamp>".
  let idRascunhoAtual = null; // começa sem id definido

  if (rascunhoIdInput && rascunhoIdInput.value) { // se o input hidden existir e tiver algum valor
    idRascunhoAtual = rascunhoIdInput.value; // usa o valor do campo oculto como id do rascunho
  } else if (rascunhoEmEdicaoId) { // caso contrário, se a variável global tiver algum valor
    idRascunhoAtual = rascunhoEmEdicaoId; // usa o valor global como fallback
  }

  // Se ainda não houver um id definido, significa que este é um rascunho novo.
  // Nesse caso, geramos um id estável agora, para que a partir deste salvamento em diante
  // o mesmo id seja reaproveitado (tanto no storage quanto no formulário).
  if (!idRascunhoAtual) { // se ainda não temos id (primeiro salvamento do rascunho)
    idRascunhoAtual = "draft-" + Date.now(); // cria um id simples e único baseado no timestamp atual

    // Atualiza também as fontes de verdade para os próximos salvamentos:
    rascunhoEmEdicaoId = idRascunhoAtual; // guarda o id na variável global
    if (rascunhoIdInput) { // se o input hidden existir na página
      rascunhoIdInput.value = idRascunhoAtual; // grava o id recém-gerado no campo oculto
    }
    if (formAvaliacao && formAvaliacao.dataset) { // se o formulário suportar dataset
      formAvaliacao.dataset.rascunhoId = idRascunhoAtual; // sincroniza também no dataset, se você estiver usando
    }
  }

  // (opcional, pra debug) — aqui você pode ver o id REAL que vai ser usado:
  // window.alert(
  //   "idRascunhoAtual: " +
  //     idRascunhoAtual +
  //     " ; rascunhoEmEdicaoId: " +
  //     rascunhoEmEdicaoId
  // ); // alerta para ajudar no debug da origem do id

  // Coleta imagens de Localização e Q2 Switch (se disponíveis)
  let localizacaoImagens = [];
  let q2SwitchImagens = [];
  
  if (window.localizacaoImagens && typeof window.localizacaoImagens.getLinhas === "function") {
    localizacaoImagens = window.localizacaoImagens.getLinhas()
      .filter(linha => linha.url)
      .map(linha => ({
        id: linha.id,
        url: linha.url,
        descricao: linha.descricao || ""
      }));
  }
  
  if (window.q2SwitchImagens && typeof window.q2SwitchImagens.getLinhas === "function") {
    q2SwitchImagens = window.q2SwitchImagens.getLinhas()
      .filter(linha => linha.url)
      .map(linha => ({
        id: linha.id,
        url: linha.url,
        descricao: linha.descricao || ""
      }));
  }

  const base = {
    id: idRascunhoAtual, // usa o id descoberto (hidden ou global) para o rascunho
    tipo_formulario: tipoFormularioAtual, // salva o tipo de formulário (UTP/Fibra ou Câmeras) para futura restauração
    rotulo: rotuloCliente, // rótulo amigável para exibir na lista de rascunhos
    form_values: valores, // objeto contendo todos os valores dos campos do formulário (mapeados por id)
    lista_materiais_infra: listaMateriaisInfra, // armazena a lista de materiais de infraestrutura coletada da tabela dinâmica
    avaliacao_id: avaliacaoEmEdicaoId, // se estivermos editando uma avaliação existente, associa o id da avaliação
    avaliacao_codigo: avaliacaoEmEdicaoCodigo, // código da avaliação em edição (ex: "AV-001")
    localizacao_imagens: localizacaoImagens, // imagens da seção Localização
    q2_switch_imagens: q2SwitchImagens, // imagens da seção Q2 Switch
  }; // fecha o objeto base de rascunho


  return base; // devolve o objeto de rascunho montado
}

/**
 * Salva o estado atual do formulário como rascunho local no navegador.
 * Usa os helpers de localStorage criados na Etapa 1.
 * [MODIFICADO] Agora é async para suportar compressão de imagens.
 */
async function salvarRascunhoAtual() {
  if (!formAvaliacao) { // se o formulário não existir na tela
    return; // não há rascunho a ser salvo, encerra a função
  }

  const base = coletarEstadoFormularioComoRascunho(); // monta o objeto de rascunho a partir dos campos atuais
  
  if (!base) { // se por algum motivo não foi possível montar o rascunho    
    if (avaliacaoFeedbackEl) { // garante que o elemento de feedback exista antes de usar
      avaliacaoFeedbackEl.textContent =
        "Preencha pelo menos um campo antes de salvar o rascunho."; // orienta o usuário de que é necessário preencher algo para salvar rascunho
      avaliacaoFeedbackEl.className = "form-feedback form-error"; // aplica estilo de erro na área de feedbackfunction salvarRascunhoAtual() {
    }
    return; // encerra a função, pois não há rascunho válido
  }

  try {
    // Comprime imagens antes de salvar no localStorage
    if (base.localizacao_imagens && base.localizacao_imagens.length > 0) {
      base.localizacao_imagens = await comprimirImagensParaRascunho(base.localizacao_imagens);
    }
    if (base.q2_switch_imagens && base.q2_switch_imagens.length > 0) {
      base.q2_switch_imagens = await comprimirImagensParaRascunho(base.q2_switch_imagens);
    }

    const rascunhoSalvo = salvarOuAtualizarRascunhoLocal(base); // chama o helper que cria/atualiza o rascunho no localStorage
    
    rascunhoEmEdicaoId = rascunhoSalvo.id; // atualiza a variável global com o id do rascunho recém-salvo

    if (rascunhoIdInput) { // se o input hidden existir
      rascunhoIdInput.value = rascunhoSalvo.id; // grava o id do rascunho salvo no campo oculto
    }
    
    if (formAvaliacao && formAvaliacao.dataset) { // se o formulário existir e suportar dataset
      formAvaliacao.dataset.rascunhoId = rascunhoSalvo.id; // sincroniza o id do rascunho atual no dataset do formulário
    }

    if (avaliacaoFeedbackEl) { // se o elemento de feedback estiver disponível
      avaliacaoFeedbackEl.textContent =
        "Rascunho salvo localmente neste dispositivo."; // mensagem de sucesso para o usuário
      avaliacaoFeedbackEl.className = "form-feedback form-success"; // aplica o estilo de sucesso na área de feedback
    }
    
    renderizarListaRascunhos(); // atualiza a tabela de rascunhos para refletir o novo/atualizado
    //formAvaliacao.reset();
  } catch (error) {
    console.error("Erro ao salvar rascunho local:", error); // registra o erro no console para facilitar debug

    if (avaliacaoFeedbackEl) { // se o elemento de feedback existir
      avaliacaoFeedbackEl.textContent =
        "Erro ao salvar rascunho local. Verifique o espaço disponível no navegador."; // mensagem mais específica de erro de salvamento
      avaliacaoFeedbackEl.className = "form-feedback form-error"; // aplica estilo de erro na área de feedback
    }
  }
}

/**
 * Salva o formulário como rascunho local de forma silenciosa,
 * sem alterar mensagens de feedback na interface.
 * Esta função é usada pelo salvamento automático (autosave).
 * [MODIFICADO] Agora é async para suportar compressão de imagens.
 */
async function salvarRascunhoAutomatico() {
  if (!formAvaliacao) { // se o formulário não existir no DOM
    return; // não há o que salvar, encerra a função imediatamente
  }

  // Não salvar automaticamente se o usuário for Visualizador
  try {
    if (isVisualizador && typeof isVisualizador === 'function' && isVisualizador()) {
      return;
    }
  } catch (e) {}

  const base = coletarEstadoFormularioComoRascunho(); // monta o objeto de rascunho com os valores atuais dos campos
  
  if (!base) {
    return;
  }

  try {
    // Comprime imagens antes de salvar no localStorage
    if (base.localizacao_imagens && base.localizacao_imagens.length > 0) {
      base.localizacao_imagens = await comprimirImagensParaRascunho(base.localizacao_imagens);
    }
    if (base.q2_switch_imagens && base.q2_switch_imagens.length > 0) {
      base.q2_switch_imagens = await comprimirImagensParaRascunho(base.q2_switch_imagens);
    }

    const rascunhoSalvo = salvarOuAtualizarRascunhoLocal(base); // chama o helper que cria/atualiza o rascunho no localStorage

    rascunhoEmEdicaoId = rascunhoSalvo.id; // garante que a variável global mantenha o id do rascunho mais recente

    if (rascunhoIdInput) { // se o input hidden existir
      rascunhoIdInput.value = rascunhoSalvo.id; // mantém o id sincronizado no campo oculto
    }

    if (formAvaliacao && formAvaliacao.dataset) { // se o formulário existir na página
      formAvaliacao.dataset.rascunhoId = rascunhoSalvo.id; // atualiza também o dataset com o id do rascunho salvo automaticamente
    }    

    renderizarListaRascunhos(); // atualiza a tabela de rascunhos para refletir o novo/atualizado

    // Nesta função não mostramos nenhuma mensagem na tela,
    // pois ela pode ser chamada com muita frequência (autosave).
  } catch (error) {
    console.error("Erro ao salvar rascunho automático:", error); // registra o erro no console para facilitar debug, mas não altera o UI
  }
}

/**
 * Agenda o salvamento automático do rascunho alguns milissegundos após a última digitação.
 * Usa um "debounce" simples: sempre cancela o timer anterior antes de criar um novo.
 */
function agendarAutoSalvarRascunho() {
  if (!formAvaliacao) { // se o formulário não existir
    return; // não há o que salvar automaticamente
  }

  // Se o usuário for Visualizador, não agendar autosave
  try {
    if (isVisualizador && typeof isVisualizador === 'function' && isVisualizador()) {
      if (autoSaveTimeoutId !== null) { clearTimeout(autoSaveTimeoutId); autoSaveTimeoutId = null; }
      return;
    }
  } catch (e) {}

  if (autoSaveTimeoutId !== null) { // se já existir um timer de autosave pendente
    clearTimeout(autoSaveTimeoutId); // cancela o timer anterior para evitar múltiplos salvamentos desnecessários
    autoSaveTimeoutId = null; // reseta a referência do timer
  }

  autoSaveTimeoutId = window.setTimeout(() => { // cria um novo timer para o salvamento automático
    salvarRascunhoAutomatico(); // quando o tempo expirar, salva o rascunho de forma silenciosa
    // Opcionalmente, poderíamos atualizar a lista de rascunhos aqui:
    // renderizarListaRascunhos();
  }, AUTO_SAVE_DELAY_MS); // usa o atraso configurado em AUTO_SAVE_DELAY_MS (por padrão, 2 segundos)
}

/**
 * Formata uma string de data ISO (ex.: "2025-12-09T13:45:00Z")
 * para o formato curto "dd/mm/aaaa HH:MM".
 */
function formatarDataHoraCurta(isoString) {
  if (!isoString) { // se não houver valor informado
    return "-"; // devolve um traço, indicando ausência de informação
  }

  const data = new Date(isoString); // tenta criar um objeto Date a partir da string ISO

  if (Number.isNaN(data.getTime())) { // se a data não for válida
    return isoString; // devolve o texto original para não perder a informação
  }

  const dia = String(data.getDate()).padStart(2, "0"); // extrai o dia do mês e preenche com zero à esquerda
  const mes = String(data.getMonth() + 1).padStart(2, "0"); // extrai o mês (0-11), soma 1 e preenche com zero à esquerda
  const ano = data.getFullYear(); // extrai o ano com 4 dígitos
  const hora = String(data.getHours()).padStart(2, "0"); // extrai a hora (0-23) e preenche com zero à esquerda
  const minuto = String(data.getMinutes()).padStart(2, "0"); // extrai os minutos e preenche com zero à esquerda

  return `${dia}/${mes}/${ano} ${hora}:${minuto}`; // monta a string final no formato desejado
}

/**
 * Preenche o formulário de avaliação a partir de um objeto de rascunho já carregado.
 * Este rascunho contém:
 *  - tipo_formulario
 *  - rotulo
 *  - form_values: mapa id-do-campo => valor (value/checked) capturado na Etapa 2
 *  - avaliacao_id (opcional)
 */
function carregarRascunhoNoFormulario(rascunho) {
  if (!formAvaliacao || !rascunho) { // se o formulário não existir ou o rascunho for inválido
    return; // não há nada a fazer
  }

  // Limpamos o formulário para evitar lixo de uma edição anterior
  resetarFormularioParaNovaAvaliacao(); // usa a função existente para voltar ao estado "Nova Avaliação"

  // Vincula o formulário ao rascunho atual
  rascunhoEmEdicaoId = rascunho.id || null; // guarda o id do rascunho atualmente carregado
  avaliacaoEmEdicaoId = rascunho.avaliacao_id || null; // se este rascunho estiver associado a uma avaliação específica, guarda o id
  avaliacaoEmEdicaoCodigo = rascunho.avaliacao_codigo || null; // restaura o código da avaliação do rascunho

  if (rascunhoIdInput) { // se o campo oculto existir
    rascunhoIdInput.value = rascunho.id || ""; // grava o id do rascunho carregado no campo hidden
  }

  if (formAvaliacao && formAvaliacao.dataset) { // se o formulário de avaliação existir
    formAvaliacao.dataset.rascunhoId = rascunho.id || ""; // grava o id do rascunho carregado no dataset do formulário
  }

  const tipo = rascunho.tipo_formulario || "utp_fibra"; // garante um tipo de formulário válido (UTP/Fibra como padrão)

  if (tipoFormularioInput) { // se o input hidden de tipo existir
    tipoFormularioInput.value = tipo; // atualiza o valor armazenado no hidden
  }

  aplicarVisibilidadeTipoFormulario(tipo); // atualiza abas e blocos do formulário (UTP/Fibra x Câmeras)

  // Ajusta título e subtítulo para deixar claro que é um rascunho
  if (formTituloEl) { // se o título do formulário estiver disponível
    if (avaliacaoEmEdicaoId) { // se existir um id de avaliação associado
      formTituloEl.textContent = "Edição de avaliação (rascunho local)"; // título indicando edição com rascunho
    } else {
      formTituloEl.textContent = "Nova Avaliação (rascunho local)"; // título indicando nova avaliação a partir de rascunho
    }
  }

  if (formSubtituloEl) { // se o subtítulo do formulário existir
    formSubtituloEl.textContent =
      "Este rascunho está salvo apenas neste dispositivo e ainda não foi enviado ao servidor."; // texto explicando a natureza local do rascunho
  }

  const valores = rascunho.form_values || {}; // obtém o mapa de valores dos campos (id => valor) salvo no rascunho

  const listaMateriaisInfra =
    Array.isArray(rascunho.lista_materiais_infra) // verifica se o rascunho possui uma lista de materiais de infraestrutura e se ela é um array válido
      ? rascunho.lista_materiais_infra // se for um array, usa diretamente a lista salva
      : []; // caso contrário (rascunhos antigos), utiliza um array vazio para manter a compatibilidade

  preencherListaMateriaisInfraAPartirDeDados(listaMateriaisInfra); // recria as linhas da tabela de materiais de infraestrutura a partir da lista vinda do rascunho

  Object.keys(valores).forEach((campoId) => { // percorre cada id de campo salvo no rascunho
    const campo = document.getElementById(campoId); // tenta localizar o elemento correspondente no DOM
    if (!campo) { // se o elemento não existir (campo removido ou renomeado)
      return; // simplesmente ignora esse campo
    }

    const valor = valores[campoId]; // obtém o valor salvo para este campo

    if (campo.type === "checkbox") { // se o campo for um checkbox
      campo.checked = !!valor; // marca ou desmarca o checkbox com base em um booleano
    } else {
      campo.value = valor != null ? valor : ""; // para outros tipos de campo, define o value (ou string vazia se null/undefined)
    }
  });

  // Depois de aplicar os valores brutos nos campos,
  // reaplicamos as lógicas de visibilidade que normalmente são disparadas
  // pelos eventos "change" dos selects/inputs.
  if (typeof atualizarVisibilidadeClienteOutro === "function") { // se a função específica do cliente existir
    atualizarVisibilidadeClienteOutro(); // garante que o campo "Cliente (Outro)" apareça/esconda conforme o valor atual do select
  }
  if (typeof atualizarVisibilidadeMarcaCabOutro === "function") { // se a função de marca de cabeamento UTP existir
    atualizarVisibilidadeMarcaCabOutro(); // ajusta visibilidade do campo "Outro" de marca de cabeamento UTP
  }
  if (typeof atualizarVisibilidadeMarcaCaboOpticoOutro === "function") { // se a função de marca de cabo óptico existir
    atualizarVisibilidadeMarcaCaboOpticoOutro(); // ajusta visibilidade do campo "Outro" de marca de cabo óptico
  }
  if (typeof atualizarVisibilidadeModeloPatchPanel === "function") { // se a função de modelo de patch panel existir
    atualizarVisibilidadeModeloPatchPanel(); // atualiza a visibilidade/estado relacionado ao modelo de patch panel
  }
  if (typeof atualizarVisibilidadeModeloPatchPanelOutro === "function") { // se a função de "modelo patch panel - Outro" existir
    atualizarVisibilidadeModeloPatchPanelOutro(); // atualiza a visibilidade do campo "Outro" para modelo de patch panel
  }
  if (typeof atualizarVisibilidadeModeloDio === "function") { // se a função de modelo de DIO existir
    atualizarVisibilidadeModeloDio(); // ajusta visibilidade do modelo de DIO conforme seleção atual
  }
  if (typeof atualizarVisibilidadeCamera === "function") { // se a função de visibilidade de câmera existir
    atualizarVisibilidadeCamera(); // ajusta visibilidades na seção de câmeras (novo x realocação, etc.)
  }
  if (typeof atualizarVisibilidadeNvrdvr === "function") { // se a função de visibilidade de NVR/DVR existir
    atualizarVisibilidadeNvrdvr(); // ajusta campos de NVR/DVR de acordo com o estado atual
  }
  if (typeof atualizarVisibilidadeFornecedorSwitch === "function") { // se a função de fornecedor de switch existir
    atualizarVisibilidadeFornecedorSwitch(); // ajusta campos relacionados ao fornecedor/modelo de switch
  }
  if (typeof atualizarVisibilidadeModeloPlataforma === "function") { // se a função de modelo de plataforma existir
    atualizarVisibilidadeModeloPlataforma(); // reaplica visibilidade nas opções de plataforma de pré-requisitos
  }
  if (typeof atualizarVisibilidadeQtdGuiasCabos === "function") { // se a função de quantidade de guias/cabos existir
    atualizarVisibilidadeQtdGuiasCabos(); // recalcula visibilidade de campos dependentes de quantidade de guias/cabos
  }

  // Atualizar visibilidade dos campos condicionais Q10
  if (typeof atualizarVisibilidadeQ10ServoMotor === "function")
    atualizarVisibilidadeQ10ServoMotor();
  if (typeof atualizarVisibilidadeQ10ServoMotorQtd === "function")
    atualizarVisibilidadeQ10ServoMotorQtd();
  if (typeof atualizarVisibilidadeQ10SuporteEletroimaQtd === "function")
    atualizarVisibilidadeQ10SuporteEletroimaQtd();
  if (typeof atualizarVisibilidadeQ10BotoeiraSaidaQtd === "function")
    atualizarVisibilidadeQ10BotoeiraSaidaQtd();
  if (typeof atualizarVisibilidadeQ10BotoeiraEmergenciaQtd === "function")
    atualizarVisibilidadeQ10BotoeiraEmergenciaQtd();
  if (typeof atualizarVisibilidadeQ10LeitorCartaoQtd === "function")
    atualizarVisibilidadeQ10LeitorCartaoQtd();
  if (typeof atualizarVisibilidadeQ10LeitorFacialQtd === "function")
    atualizarVisibilidadeQ10LeitorFacialQtd();
  if (typeof atualizarVisibilidadeQ10SensorPresencaQtd === "function")
    atualizarVisibilidadeQ10SensorPresencaQtd();
  if (typeof atualizarVisibilidadeQ10SensorBarreiraQtd === "function")
    atualizarVisibilidadeQ10SensorBarreiraQtd();

  // Atualizar visibilidade dos campos condicionais Q10 - Modelos
  if (typeof atualizarVisibilidadeQ10EletroimãFechaduraModeloQtd === "function")
    atualizarVisibilidadeQ10EletroimãFechaduraModeloQtd();
  if (typeof atualizarVisibilidadeQ10MolaHidraulicaTipoQtd === "function")
    atualizarVisibilidadeQ10MolaHidraulicaTipoQtd();
  if (typeof atualizarVisibilidadeQ10BotoeiraSaidaModeloQtd === "function")
    atualizarVisibilidadeQ10BotoeiraSaidaModeloQtd();
  if (typeof atualizarVisibilidadeQ10BotoeiraEmergenciaModeloQtd === "function")
    atualizarVisibilidadeQ10BotoeiraEmergenciaModeloQtd();
  if (typeof atualizarVisibilidadeQ10LeitorCartaoModeloQtd === "function")
    atualizarVisibilidadeQ10LeitorCartaoModeloQtd();
  if (typeof atualizarVisibilidadeQ10LeitorFacialModeloQtd === "function")
    atualizarVisibilidadeQ10LeitorFacialModeloQtd();
  if (typeof atualizarVisibilidadeQ10SensorPresencaModeloQtd === "function")
    atualizarVisibilidadeQ10SensorPresencaModeloQtd();
  if (typeof atualizarVisibilidadeQ10SensorBarreiraModeloQtd === "function")
    atualizarVisibilidadeQ10SensorBarreiraModeloQtd();

  // Atualizar visibilidade dos campos condicionais Q6
  if (typeof atualizarVisibilidadeQ6LeitorFacialQtd === "function")
    atualizarVisibilidadeQ6LeitorFacialQtd();
  if (typeof atualizarVisibilidadeQ6SuporteLeitorFacialQtd === "function")
    atualizarVisibilidadeQ6SuporteLeitorFacialQtd();
  if (typeof atualizarVisibilidadeQ6LeitorCartaoQtd === "function")
    atualizarVisibilidadeQ6LeitorCartaoQtd();
  if (typeof atualizarVisibilidadeQ6SuporteLeitorCartaoQtd === "function")
    atualizarVisibilidadeQ6SuporteLeitorCartaoQtd();

  // Carrega imagens de Localização do rascunho
  if (Array.isArray(rascunho.localizacao_imagens) && rascunho.localizacao_imagens.length > 0) {
    if (window.localizacaoImagens && typeof window.localizacaoImagens.setLinhas === "function") {
      // Converte para o formato esperado pelo componente
      const linhasLocalizacao = rascunho.localizacao_imagens.map((img, idx) => ({
        id: img.id || "loc_rascunho_" + idx,
        url: img.url || "",
        descricao: img.descricao || ""
      }));
      window.localizacaoImagens.setLinhas(linhasLocalizacao);
    }
  }

  // Carrega imagens de Q2 Switch do rascunho
  if (Array.isArray(rascunho.q2_switch_imagens) && rascunho.q2_switch_imagens.length > 0) {
    if (window.q2SwitchImagens && typeof window.q2SwitchImagens.setLinhas === "function") {
      // Converte para o formato esperado pelo componente
      const linhasQ2Switch = rascunho.q2_switch_imagens.map((img, idx) => ({
        id: img.id || "q2s_rascunho_" + idx,
        url: img.url || "",
        descricao: img.descricao || ""
      }));
      window.q2SwitchImagens.setLinhas(linhasQ2Switch);
    }
  }

  if (avaliacaoFeedbackEl) { // se a área de feedback do formulário existir
    avaliacaoFeedbackEl.textContent =
      "Rascunho carregado no formulário (ainda não salvo no servidor)."; // mensagem informativa para o usuário
    avaliacaoFeedbackEl.className = "form-feedback form-success"; // usa estilo de sucesso para destacar a ação concluída
  }
}

/**
 * Localiza um rascunho pelo id no localStorage e chama `carregarRascunhoNoFormulario`.
 */
function carregarRascunhoNoFormularioPorId(idRascunho) {
  if (!idRascunho) { // se não for passado um id válido
    return; // não tenta carregar nada
  }

  const todos = lerRascunhosDoStorage(); // lê todos os rascunhos salvos no navegador

  const encontrado = todos.find((item) => {
    // compara como string para evitar problemas de tipo (número vs texto, draft-123 vs 123, etc.)
    return String(item.id) === String(idRascunho); // garante comparação sempre em formato de texto
  }); // procura o rascunho com o id correspondente no array vindo do localStorage



  if (!encontrado) { // se não encontrar o rascunho
    if (avaliacaoFeedbackEl) { // se a área de feedback existir
      avaliacaoFeedbackEl.textContent =
        "Rascunho não encontrado. Ele pode ter sido excluído."; // mensagem explicando o problema
      avaliacaoFeedbackEl.className = "form-feedback form-error"; // estilo de erro para chamar atenção
    }
    return; // encerra a função
  }

  carregarRascunhoNoFormulario(encontrado); // delega o preenchimento do formulário para a função específica
}

/**
 * Remove do localStorage rascunhos considerados "vazios":
 * - form_values sem nenhum campo relevante preenchido
 * - e sem lista de materiais de infraestrutura preenchida.
 * - e sem imagens de Localização ou Q2 Switch.
 */
function removerRascunhosVaziosDoStorage() {
  const todos = lerRascunhosDoStorage();                             // lê a lista completa de rascunhos do storage bruto
  if (!Array.isArray(todos) || todos.length === 0) {                 // se não houver rascunhos ou o formato estiver incorreto
    return;                                                          // não há nada para limpar, encerra a função
  }

  const filtrados = todos.filter((item) => {                         // monta uma nova lista apenas com rascunhos que queremos manter
    if (!item || typeof item !== "object") {                         // se o item não for um objeto válido
      return false;                                                  // descarta esse item do storage
    }

    const formValues = item.form_values || {};                       // obtém o mapa de valores do formulário salvo no rascunho (ou objeto vazio)
    const vazioForm = formularioRascunhoEstaVazio(formValues);       // verifica se esses valores caracterizam um formulário vazio

    const temMateriais =
      Array.isArray(item.lista_materiais_infra) &&                   // confere se o rascunho possui uma lista de materiais de infraestrutura
      item.lista_materiais_infra.length > 0;                         // e se essa lista contém pelo menos um item

    // Verifica se tem imagens de Localização
    const temImagensLocalizacao =
      Array.isArray(item.localizacao_imagens) &&
      item.localizacao_imagens.some(img => img.url);

    // Verifica se tem imagens de Q2 Switch
    const temImagensQ2Switch =
      Array.isArray(item.q2_switch_imagens) &&
      item.q2_switch_imagens.some(img => img.url);

    // [MODIFICADO] Considera vazio apenas se não tiver nada relevante
    if (vazioForm && !temMateriais && !temImagensLocalizacao && !temImagensQ2Switch) {
      return false;                                                  // este rascunho é considerado "fantasma" e será removido
    }

    return true;                                                     // caso contrário, mantemos o rascunho na lista filtrada
  });

  if (filtrados.length !== todos.length) {                           // se houve alguma alteração na quantidade de rascunhos
    gravarRascunhosNoStorage(filtrados);                             // grava a nova lista filtrada de volta no localStorage
  }
}

/**
 * Renderiza na tabela HTML a lista de rascunhos locais do usuário atual.
 */
function renderizarListaRascunhos() {
  if (!rascunhosTbody) { // se a tabela de rascunhos não existir no DOM
    return; // não há onde desenhar a lista
  }

  removerRascunhosVaziosDoStorage();

  const rascunhos = obterRascunhosDoUsuarioAtual(); // obtém todos os rascunhos associados ao usuário atual (ou sem user_id)
  rascunhosTbody.innerHTML = ""; // limpa o conteúdo atual da tabela para redesenhar do zero

  if (!rascunhos || rascunhos.length === 0) { // se não houver nenhum rascunho para exibir
    const linhaVazia = document.createElement("tr"); // cria uma nova linha de tabela
    const celula = document.createElement("td"); // cria uma célula única
    celula.colSpan = 5; // faz a célula ocupar todas as colunas da tabela (agora são 5)
    celula.className = "table-empty"; // aplica a classe de estilo de linha vazia
    celula.textContent = "Nenhum rascunho salvo neste dispositivo."; // mensagem informando que não há rascunhos
    linhaVazia.appendChild(celula); // adiciona a célula à linha
    rascunhosTbody.appendChild(linhaVazia); // adiciona a linha à tabela
    atualizarBadgeRascunhosAPartirDoStorage(0);
    return; // encerra a função, pois já tratamos o caso sem rascunhos
  }

  const ordenados = [...rascunhos].sort((a, b) => { // cria uma cópia da lista e ordena por data de atualização
    const aTime = Date.parse(a.atualizado_em || a.criado_em || "") || 0; // tenta converter o timestamp do rascunho A em número
    const bTime = Date.parse(b.atualizado_em || b.criado_em || "") || 0; // tenta converter o timestamp do rascunho B em número
    return bTime - aTime; // ordena do mais recente para o mais antigo
  });

  ordenados.forEach((rascunho) => { // percorre cada rascunho já ordenado
    const linha = document.createElement("tr"); // cria uma nova linha de tabela para o rascunho atual
    linha.style.cursor = "pointer"; // indica visualmente que a linha é clicável
    linha.title = "Clique para carregar este rascunho"; // tooltip explicativo

    const celulaRotulo = document.createElement("td"); // célula que exibirá o cliente/rótulo
    celulaRotulo.textContent = rascunho.rotulo || "Rascunho sem rótulo"; // usa o rótulo salvo ou um texto padrão

    const celulaTipo = document.createElement("td"); // célula que exibirá o tipo de formulário
    const tipo = (rascunho.tipo_formulario || "utp_fibra").toString().toLowerCase(); // normaliza o tipo em minúsculas
    celulaTipo.textContent =
      tipo === "cameras" || tipo === "câmeras" // verifica se o tipo corresponde a Câmeras
        ? "Câmeras" // texto exibido para rascunho de câmeras
        : "UTP / Fibra"; // texto exibido para rascunho de UTP/Fibra (padrão)

    // Célula que exibe a origem do rascunho (Nova ou Edição + código)
    const celulaOrigem = document.createElement("td");
    if (rascunho.avaliacao_id) {
      const codigo = rascunho.avaliacao_codigo || `#${rascunho.avaliacao_id}`;
      celulaOrigem.textContent = `Edição ${codigo}`;
      celulaOrigem.style.color = "#2563eb"; // azul para edição
    } else {
      celulaOrigem.textContent = "Nova";
      celulaOrigem.style.color = "#16a34a"; // verde para nova
    }

    const celulaData = document.createElement("td"); // célula que exibirá a data de atualização
    celulaData.textContent = formatarDataHoraCurta(
      rascunho.atualizado_em || rascunho.criado_em
    ); // formata o timestamp para exibição amigável

    const celulaAcoes = document.createElement("td"); // célula que conterá os botões de ação

    // Botão "Carregar" removido - agora carrega ao clicar na linha

    const botaoExcluir = document.createElement("button"); // cria o botão "Excluir"
    botaoExcluir.type = "button"; // define o tipo como botão simples
    botaoExcluir.className = "btn btn-excluir btn-small"; // aplica estilos do botão de exclusão
    botaoExcluir.innerHTML = "🗑️"; // ícone de lixeira
    botaoExcluir.title = "Excluir rascunho"; // tooltip para acessibilidade
    botaoExcluir.dataset.action = "excluir-rascunho"; // data-atributo indicando que a ação é excluir o rascunho
    botaoExcluir.dataset.rascunhoId = rascunho.id; // associa o mesmo id de rascunho ao botão

    celulaAcoes.appendChild(botaoExcluir); // adiciona apenas o botão "Excluir" à célula de ações

    linha.appendChild(celulaRotulo); // adiciona a célula de rótulo à linha
    linha.appendChild(celulaTipo); // adiciona a célula de tipo à linha
    linha.appendChild(celulaOrigem); // adiciona a célula de origem à linha
    linha.appendChild(celulaData); // adiciona a célula de data à linha
    linha.appendChild(celulaAcoes); // adiciona a célula de ações à linha

    // Evento de clique na linha para carregar o rascunho
    linha.addEventListener("click", (event) => {
      // Ignora o clique se foi no botão Excluir
      if (event.target.closest("button")) return;
      carregarRascunhoNoFormulario(rascunho); // carrega o rascunho ao clicar na linha
    });

    rascunhosTbody.appendChild(linha); // finalmente adiciona a linha completa à tabela de rascunhos
  });

  atualizarBadgeRascunhosAPartirDoStorage();
  
}

/**
 * Converte um dataURL (data:image/...;base64,XXXX) para Blob.
 * Retorna também o mime detectado.
 */
function dataUrlParaBlob(dataUrl) {                                     // converte dataURL em Blob
  const partes = String(dataUrl || "").split(",");                      // separa header e base64
  const header = partes[0] || "";                                       // header (data:image/...;base64)
  const base64 = partes[1] || "";                                       // payload base64
  const match = header.match(/data:(.*?);base64/i);                     // tenta extrair o mime
  const mime = match && match[1] ? match[1] : "application/octet-stream"; // define mime com fallback
  const binStr = atob(base64);                                          // decodifica base64 para string binária
  const len = binStr.length;                                            // tamanho do binário
  const bytes = new Uint8Array(len);                                    // cria buffer de bytes
  for (let i = 0; i < len; i++) {                                       // percorre todos os bytes
    bytes[i] = binStr.charCodeAt(i);                                    // escreve byte a byte
  }                                                                     // fim loop
  return { blob: new Blob([bytes], { type: mime }), mime };             // retorna blob + mime
}                                                                       // fim função

/**
 * Mapeia mime → extensão para nomear arquivo no upload.
 */
function extensaoPorMime(mime) {                                        // helper de extensão
  if (mime === "image/jpeg") return "jpg";                              // jpeg → .jpg
  if (mime === "image/png") return "png";                               // png → .png
  if (mime === "image/webp") return "webp";                             // webp → .webp
  return "jpg";                                                        // fallback .jpg
}                                                                       // fim função

/**
 * Faz upload de uma imagem (vinda como dataURL) no backend e devolve a URL pública (/uploads/xxx).
 */
async function uploadImagemDataUrlParaBackend(avaliacaoId, contexto, dataUrl, ordem) { // upload de dataURL
  const { blob, mime } = dataUrlParaBlob(dataUrl);                      // converte dataURL em blob
  const ext = extensaoPorMime(mime);                                    // define extensão pelo mime
  const formData = new FormData();                                      // cria formdata para multipart
  formData.append("contexto", String(contexto || "geral"));             // envia contexto (ex.: q2_switch)
  formData.append(                                                      // anexa o arquivo
    "arquivo",                                                          // nome do campo esperado no backend
    blob,                                                               // blob do arquivo
    `captura_${contexto || "geral"}_${ordem || 0}_${Date.now()}.${ext}`  // filename sugerido
  );                                                                    // fim append arquivo

  const resp = await apiPostFormData(                                   // chama POST multipart
    `/avaliacoes/${avaliacaoId}/imagens/upload`,                         // endpoint novo de upload genérico
    formData                                                           // corpo multipart
  );                                                                    // fim chamada

  return resp && resp.url ? resp.url : "";                              // retorna url pública (/uploads/...)
}                                                                       // fim função

/**
 * Sincroniza as fotos do Q2 (switch) no backend:
 * - Se a linha tiver dataURL, faz upload e troca o hidden pela URL real.
 * - Depois salva a lista em PUT /avaliacoes/{id}/imagens (contexto=q2_switch).
 * - Atualiza o campo legado principal (q2-switch-foto-url) com a primeira URL.
 */
async function sincronizarImagensQ2SwitchNoBackend(avaliacaoId) {        // sincroniza Q2 no backend
  if (!avaliacaoId) return;                                             // sem id, não faz nada

  // Deletar do Storage as imagens que foram removidas
  if (q2SwitchImagensParaDeletar && q2SwitchImagensParaDeletar.length > 0) {
    for (const urlDeletar of q2SwitchImagensParaDeletar) {
      await deletarImagemDoStorage(urlDeletar);
    }
    q2SwitchImagensParaDeletar = [];
  }

  // Usa a UI de blocos se disponível
  if (window.q2SwitchImagens && typeof window.q2SwitchImagens.getLinhas === "function") {
    const linhas = window.q2SwitchImagens.getLinhas();
    const imagensParaApi = [];

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];
      const urlBruta = (linha.url || "").trim();
      const desc = (linha.descricao || "").trim();

      if (!urlBruta) continue;

      let urlFinal = urlBruta;

      if (urlBruta.startsWith("data:")) {
        const nomeBase = `avaliacao_${avaliacaoId}_switch_${i + 1}`;
        urlFinal = await uploadImagemParaStorage(urlBruta, "q2_switch", nomeBase);

        if (!urlFinal) {
          console.warn(`Falha no upload da imagem switch ${i + 1}`);
          continue;
        }

        linha.url = urlFinal;
      }

      imagensParaApi.push({
        contexto: "q2_switch",
        ordem: imagensParaApi.length + 1,
        url: urlFinal,
        descricao: desc
      });
    }

    // Sempre chama PUT para sincronizar
    // Se não houver imagens, envia uma lista vazia para que o backend delete todas do contexto q2_switch
    
    // Se houver imagens, envia normalmente. Se não houver, força envio de array vazio
    // para que o backend delete o contexto inteiro
    if (imagensParaApi.length > 0) {
      await apiPutJson(`/avaliacoes/${avaliacaoId}/imagens`, imagensParaApi);
    } else {
      // Deleta todas as imagens do contexto q2_switch
      await apiDelete(`/avaliacoes/${avaliacaoId}/imagens/contexto/q2_switch`);
    }

    window.q2SwitchImagens.setLinhas(linhas);

    const legadoPrincipal = document.getElementById("q2-switch-foto-url"); // campo legado
    if (legadoPrincipal) {                                               // se existir
      legadoPrincipal.value = imagensParaApi[0] ? imagensParaApi[0].url : ""; // primeira URL
    }

    return;
  }

  // ----- CÓDIGO LEGADO (fallback se UI nova não existir) -----
  const tbody = document.getElementById("q2-switch-fotos-tbody");        // tbody da tabela do Q2
  if (!tbody) return;                                                   // se não existir na tela, sai

  const linhas = tbody.querySelectorAll("tr.q2-switch-fotos-linha");     // pega todas as linhas
  const imagensParaApi = [];                                            // lista final para PUT /imagens

  for (let i = 0; i < linhas.length; i++) {                             // percorre linhas na ordem exibida
    const linha = linhas[i];                                            // linha atual
    const urlInput = linha.querySelector(".q2-switch-foto-url-input");   // hidden com dataURL/URL
    const descInput = linha.querySelector(".q2-switch-foto-descricao-input"); // input descrição
    const imgPreview = linha.querySelector(".q2-switch-foto-preview");   // <img> de preview
    const placeholder = linha.querySelector(".q2-switch-foto-placeholder"); // placeholder

    const urlBruta = urlInput && urlInput.value ? urlInput.value.trim() : ""; // lê url/dataURL
    const desc = descInput && descInput.value ? descInput.value.trim() : "";  // lê descrição

    if (!urlBruta) continue;                                            // se linha vazia, ignora

    let urlFinal = urlBruta;                                            // assume já ser URL real

    if (urlBruta.startsWith("data:")) {                                  // [ALTERADO] se ainda for dataURL (qualquer tipo)
      const nomeBase = `avaliacao_${avaliacaoId}_switch_${i + 1}`;
      urlFinal = await uploadImagemParaStorage(urlBruta, "q2_switch", nomeBase);

      if (!urlFinal) {
        console.warn(`Falha no upload da imagem do switch ${i + 1}`);
        continue;
      }

      if (urlInput) urlInput.value = urlFinal;                           // substitui hidden por URL real

      if (imgPreview) {                                                  // atualiza preview para apontar pro arquivo real
        imgPreview.src = urlFinal || "";                                 // aplica nova src
        imgPreview.style.display = urlFinal ? "block" : "none";           // mostra/oculta
      }                                                                  // fim if imgPreview

      if (placeholder) {                                                 // alterna placeholder
        placeholder.style.display = urlFinal ? "none" : "inline";         // esconde se houver foto
      }                                                                  // fim if placeholder
    }                                                                    // fim if dataURL

    imagensParaApi.push({                                                // adiciona ao payload do PUT /imagens
      contexto: "q2_switch",                                             // contexto do agrupamento
      ordem: imagensParaApi.length + 1,                                  // ordem contínua (sem buracos)
      url: urlFinal,                                                     // URL final (real)
      descricao: desc,                                                   // descrição da linha
    });                                                                  // fim push
  }                                                                      // fim loop

  await apiPutJson(                                                      // salva lista no backend (tabela avaliacoes_imagens)
    `/avaliacoes/${avaliacaoId}/imagens`,                                // endpoint já existente (apaga e recria)
    imagensParaApi                                                      // lista de imagens
  );                                                                    // fim PUT

  const legadoPrincipal = document.getElementById("q2-switch-foto-url");  // campo legado principal
  if (legadoPrincipal) {                                                 // se existir
    legadoPrincipal.value = imagensParaApi[0] ? imagensParaApi[0].url : ""; // primeira URL vira o legado
  }                                                                      // fim if legado
}                                                                        // fim função

/**
 * Sincroniza as imagens da seção Localização no backend.
 * Faz upload das imagens (dataURL) para Supabase Storage e salva as URLs na tabela avaliacoes_imagens.
 *
 * @param {number} avaliacaoId - id da avaliação já salva
 */
async function sincronizarImagensLocalizacaoNoBackend(avaliacaoId) {
  if (!avaliacaoId) return;

  // Deletar do Storage as imagens que foram removidas
  if (localizacaoImagensParaDeletar.length > 0) {
    for (const urlDeletar of localizacaoImagensParaDeletar) {
      await deletarImagemDoStorage(urlDeletar);
    }
    localizacaoImagensParaDeletar = [];
  }

  if (!window.localizacaoImagens || typeof window.localizacaoImagens.getLinhas !== "function") {
    return;
  }

  const linhas = window.localizacaoImagens.getLinhas();
  const imagensParaApi = [];

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    const urlBruta = (linha.url || "").trim();
    const desc = (linha.descricao || "").trim();

    if (!urlBruta) continue;

    let urlFinal = urlBruta;

    if (urlBruta.startsWith("data:")) {
      const nomeBase = `avaliacao_${avaliacaoId}_img_${i + 1}`;
      urlFinal = await uploadImagemParaStorage(urlBruta, "localizacao", nomeBase);

      if (!urlFinal) {
        console.warn(`Falha no upload da imagem de localização ${i + 1}`);
        continue;
      }

      linha.url = urlFinal;
    }

    imagensParaApi.push({
      contexto: "localizacao",
      ordem: imagensParaApi.length + 1,
      url: urlFinal,
      descricao: desc
    });
  }

  // Sempre chama API para sincronizar (inclusive lista vazia para deletar do banco)
  
  if (imagensParaApi.length > 0) {
    await apiPutJson(
      `/avaliacoes/${avaliacaoId}/imagens`,
      imagensParaApi
    );
  } else {
    // Deleta todas as imagens do contexto localizacao
    await apiDelete(`/avaliacoes/${avaliacaoId}/imagens/contexto/localizacao`);
  }

  window.localizacaoImagens.setLinhas(linhas);
}

/**
 * Lê os dados do formulário de avaliação e envia para o backend.
 * - Se não houver avaliacaoEmEdicaoId, faz POST /avaliacoes (criação).
 * - Se houver avaliacaoEmEdicaoId, faz PUT /avaliacoes/{id} (edição).
 */
async function salvarAvaliacao(event) {

  event.preventDefault(); // evita o reload padrão da página

  avaliacaoFeedbackEl.textContent = ""; // limpa textos de feedback anteriores
  avaliacaoFeedbackEl.className = "form-feedback"; // reseta as classes de estado (erro/sucesso)

  // Lê os valores do formulário
  let clienteNome = "";                                            // variável que armazenará o nome final do cliente
  if (clienteNomeInput) {                                          // garante que o select de cliente exista
    const valorSelect = clienteNomeInput.value;                    // lê o valor selecionado no combo de clientes

    if (!valorSelect) {                                            // se nenhuma opção foi selecionada
      avaliacaoFeedbackEl.textContent =
        "Selecione o cliente antes de salvar a avaliação.";        // mensagem de erro orientando o usuário
      avaliacaoFeedbackEl.className = "form-feedback form-error";  // aplica estilo de erro na mensagem
      return;                                                      // interrompe o envio do formulário
    }

    if (valorSelect === "outro") {                                 // se a opção selecionada for "Outro"
      const textoOutro =                                          // lê o texto digitado no campo de "Outro"
        (clienteNomeOutroInput && clienteNomeOutroInput.value
          ? clienteNomeOutroInput.value.trim()
          : "");

      if (!textoOutro) {                                          // se o campo "Outro" estiver vazio
        avaliacaoFeedbackEl.textContent =
          "Informe o nome do cliente no campo 'Outro'.";           // pede para preencher o texto do cliente
        avaliacaoFeedbackEl.className = "form-feedback form-error"; // aplica estilo de erro
        return;                                                    // interrompe o envio
      }

      clienteNome = `Outro: ${textoOutro}`;                        // monta o valor final no formato "Outro: <texto>"
    } else {                                                       // se não for "Outro"
      clienteNome = valorSelect;                                   // usa diretamente o valor da opção selecionada
    }
  }

  const dataAvaliacao = dataAvaliacaoInput.value; // data no formato YYYY-MM-DD vinda do input date
  const local = localInput.value.trim(); // local da avaliação
  const objeto = objetoInput.value.trim(); // objeto da avaliação
  const status = statusSelect.value || "aberto"; // status, com fallback para "aberto"
  
  // Campos comerciais (somente admin/comercial podem preencher)
  const pedidoCompraInput = document.getElementById("pedido-compra");
  const numeroPropostaInput = document.getElementById("numero-proposta");
  const pedidoCompra = pedidoCompraInput ? pedidoCompraInput.value.trim() || null : null;
  const numeroProposta = numeroPropostaInput ? numeroPropostaInput.value.trim() || null : null;

  const equipe = equipeSelect.value || null; // equipe responsável (ou null se não selecionado)
  const responsavel = responsavelInput.value.trim() || null; // responsável pela avaliação
  const contato = contatoInput.value.trim() || null; // contato do cliente
  const emailCliente = emailClienteInput.value.trim() || null; // e-mail do cliente
  const escopoTexto = escopoTextarea.value.trim() || null; // escopo / observações
  //tipo_formulario
  const tipoFormulario = tipoFormularioInput                   // lê o tipo de formulário do input hidden, se existir
    ? (tipoFormularioInput.value || "utp_fibra")               // usa o valor atual ou assume "utp_fibra" como padrão se estiver vazio
    : "utp_fibra";                                             // em ambientes antigos sem o hidden, considera "utp_fibra" como padrão
  //tipo_formulario
  // Validações mínimas de campos obrigatórios
  if (!clienteNome) {
    avaliacaoFeedbackEl.textContent = "Informe o nome do cliente."; // mensagem de erro específica
    avaliacaoFeedbackEl.classList.add("form-error"); // aplica estilo de erro
    return; // interrompe o fluxo sem chamar a API
  }

  if (!dataAvaliacao) {
    avaliacaoFeedbackEl.textContent = "Informe a data da avaliação."; // mensagem de erro específica
    avaliacaoFeedbackEl.classList.add("form-error"); // aplica estilo de erro
    return; // interrompe o fluxo sem chamar a API
  }

  let listaMateriaisInfraParaApi = []; // inicializa o array que armazenará a lista de materiais de infraestrutura preparada para envio ao backend
  
  // Monta o payload que será enviado para a API
  // OBS: serve tanto para criação quanto para atualização.
  const payload = {
    cliente_nome: clienteNome, // nome do cliente
    data_avaliacao: dataAvaliacao, // data no formato YYYY-MM-DD
    local, // local da avaliação
    objeto, // objeto da avaliação
    status, // status da avaliação
    pedido_compra: pedidoCompra, // número do pedido de compra
    numero_proposta: numeroProposta, // número da proposta comercial
    equipe, // equipe responsável
    responsavel_avaliacao: responsavel, // responsável pela avaliação
    contato, // contato do cliente
    email_cliente: emailCliente, // e-mail do cliente
    escopo_texto: escopoTexto, // escopo / observações
    //tipo_formulario
    tipo_formulario: tipoFormulario,    // tipo de formulário selecionado (utp/cameras/etc)
    //tipo_formulario
  };
  // Flags gerais
  payload.servico_fora_montes_claros =                                           // campo booleano indicando se o serviço é fora de Montes Claros
    servicoForaMC ? selectSimNaoParaBoolean(servicoForaMC) : null;              // converte o valor "sim"/"nao" do <select> para booleano (ou null se não houver seleção)

  payload.servico_intermediario =                                                // campo booleano indicando se o serviço é para intermediário/empreiteira
    servicoIntermediario ? selectSimNaoParaBoolean(servicoIntermediario) : null; // converte o valor "sim"/"nao" do <select> para booleano (ou null se não houver seleção)

  // Quantitativo 01 – Patch Panel / Cabeamento
  payload.q1_categoria_cab =
    q1Categoria && q1Categoria.value ? q1Categoria.value : null;  // categoria do cabeamento (CAT5e/CAT6/CAT6A)

  payload.q1_blindado = q1Blindado
    ? selectSimNaoParaBoolean(q1Blindado)                        // converte "sim"/"nao" para boolean (cabeamento blindado?)
    : null;

  payload.q1_novo_patch_panel = q1NovoPatch
    ? selectSimNaoParaBoolean(q1NovoPatch)                       // converte "sim"/"nao" para boolean (necessita novo patch panel?)
    : null;

  payload.q1_incluir_guia = q1IncluirGuia
    ? selectSimNaoParaBoolean(q1IncluirGuia)                     // converte "sim"/"nao" para boolean (incluir guia de cabos?)
    : null;

  payload.q1_qtd_pontos_rede = intOrNullFromInput(q1QtdPontosRede); // quantidade de pontos de rede
  payload.q1_qtd_cabos = intOrNullFromInput(q1QtdCabos);             // quantidade de cabos
  payload.q1_qtd_portas_patch_panel = intOrNullFromInput(
    q1QtdPortasPP
  );                                                              // quantidade de portas no patch panel
  payload.q1_qtd_patch_cords = intOrNullFromInput(
    q1QtdPatchCords
  );                                                              // quantidade de patch cords

  let modeloPatchPanelFinal = null;                              // variável para armazenar o valor final de modelo de patch panel

if (q1ModeloPatchPanel) {                                       // se o select de modelo de patch panel existir
    const valorModelo = q1ModeloPatchPanel.value;                 // lê o valor atualmente selecionado no combo

  if (valorModelo === "outro") {                                // se a opção escolhida for "Outro (especificar)"
      const textoOutro =                                        // variável para armazenar o texto digitado no campo "Outro"
        q1ModeloPatchPanelOutroInput &&                         // garante que o input de "Outro" exista
        q1ModeloPatchPanelOutroInput.value                      // pega o valor bruto do input
          ? q1ModeloPatchPanelOutroInput.value.trim()           // remove espaços extras no início/fim, se houver texto
          : "";                                                 // se não houver nada digitado, usa string vazia

      if (textoOutro) {                                         // se o usuário tiver digitado algum texto no campo "Outro"
        modeloPatchPanelFinal = `Outro: ${textoOutro}`;         // monta a string no formato "Outro: <texto digitado>"
      } else {                                                  // se o campo "Outro" estiver vazio
        modeloPatchPanelFinal = null;                           // não envia modelo de patch panel (valor null no payload)
      }
    } else if (valorModelo) {                                   // se o valor do select não for vazio nem "outro"
      modeloPatchPanelFinal = valorModelo;                      // usa diretamente o valor selecionado (CommScope/Furukawa/Systimax)
    } else {                                                    // se o select estiver vazio
      modeloPatchPanelFinal = null;                             // não envia modelo (null) para o backend
    }
  }

  payload.q1_modelo_patch_panel = modeloPatchPanelFinal;        // grava no payload o valor final calculado (fixo ou "Outro: <texto>")

  let marcaCabFinal = null;                                    // variável que armazenará o valor final da marca de cabeamento

  if (q1MarcaCab) {                                            // se o select de marca existir
    const valorSelectMarca = q1MarcaCab.value;                 // obtém o valor selecionado no combo (CommScope/Furukawa/outro)

    if (!valorSelectMarca) {                                   // se nada foi selecionado
      marcaCabFinal = null;                                    // não envia valor (campo em branco)
    } else if (valorSelectMarca === "outro") {                 // se a opção selecionada for "Outro"
      const textoOutro =                                       // pega o texto digitado no campo "Outro" de marca
        q1MarcaCabOutroInput && q1MarcaCabOutroInput.value     // se o input existir, lê o valor
          ? q1MarcaCabOutroInput.value.trim()                  // remove espaços extras do início/fim
          : "";                                                // se não houver input ou texto, considera string vazia

      marcaCabFinal = textoOutro                               // define valor final em função do texto
        ? `Outro: ${textoOutro}`                               // se tiver texto, usa o formato "Outro: <texto>"
        : null;                                                // se não tiver texto, não envia valor
    } else {                                                   // se for uma opção fixa (CommScope ou Furukawa)
      marcaCabFinal = valorSelectMarca;                        // usa o valor selecionado diretamente
    }                                                          // fim do if aninhado para valorSelectMarca
  }                                                            // fim do if q1MarcaCab

  payload.q1_marca_cab = marcaCabFinal;                        // atribui o valor final calculado ao payload

  payload.q1_qtd_guias_cabos = intOrNullFromInput(             // converte o valor digitado em número inteiro ou null
    q1QtdGuiasCabos                                             // elemento de input de quantidade de guias de cabos
  );                                                            // fecha chamada da função de conversão

  payload.q1_patch_cords_modelo =                              // campo com o modelo/descrição dos patch cords
    q1PatchCordsModelo && q1PatchCordsModelo.value.trim()      // verifica se o input existe e se há texto preenchido
      ? q1PatchCordsModelo.value.trim()                        // se houver texto, usa o valor sem espaços nas pontas
      : null;                                                  // se não houver, envia null (campo vazio)

  payload.q1_patch_cords_cor =                                 // campo com a cor dos patch cords
    q1PatchCordsCor && q1PatchCordsCor.value.trim()            // verifica se o input de cor existe e se há texto
      ? q1PatchCordsCor.value.trim()                           // se houver, usa o texto da cor sem espaços extras
      : null;                                                  // se não houver, envia null

  payload.q1_patch_panel_existente_nome =                      // campo com identificação do patch panel já existente
    q1PatchPanelExistenteNome &&                               // verifica se o input de identificação existe
    q1PatchPanelExistenteNome.value.trim()                     // e se há algum texto digitado
      ? q1PatchPanelExistenteNome.value.trim()                 // se houver, usa o texto sem espaços nas pontas
      : null;                                                  // se não houver texto, envia null

  // Quantitativo 02 – Switch
  payload.q2_novo_switch = q2NovoSwitch
    ? selectSimNaoParaBoolean(q2NovoSwitch)                              // converte "sim"/"nao" em boolean para novo switch
    : null;
  // payload.q2_switch_poe = q2SwitchPoe
  //   ? selectSimNaoParaBoolean(q2SwitchPoe)                               // LEGADO - converte "sim"/"nao" em boolean para PoE
  //   : null;
  // payload.q2_rede_industrial = q2RedeIndustrial
  //   ? selectSimNaoParaBoolean(q2RedeIndustrial)                          // LEGADO - converte "sim"/"nao" em boolean para rede industrial
  //   : null;
  // payload.q2_qtd_pontos_rede = intOrNullFromInput(q2QtdPontosRede);      // quantidade de pontos atendidos via switch
  // payload.q2_qtd_portas_switch = intOrNullFromInput(q2QtdPortasSwitch);  // quantidade de portas do switch

  payload.q2_fornecedor_switch =
    q2FornecedorSwitch && q2FornecedorSwitch.value
      ? q2FornecedorSwitch.value                                         // "quotation_evaluation" ou "cliente"
      : null;

  payload.q2_modelo_switch =
    q2ModeloSwitch && q2ModeloSwitch.value.trim()
      ? q2ModeloSwitch.value.trim()                                      // modelo/descrição do switch
      : null;

  payload.q2_switch_foto_url =
    q2SwitchFotoUrl && q2SwitchFotoUrl.value.trim()
      ? q2SwitchFotoUrl.value.trim()                                     // URL da foto do switch
      : null;

  // payload.q2_switch_existente_nome =
  //   q2SwitchExistenteNome && q2SwitchExistenteNome.value.trim()
  //     ? q2SwitchExistenteNome.value.trim()                               // identificação do switch existente
  //     : null;

  payload.q2_observacoes =
    q2ObsSwitch && q2ObsSwitch.value.trim()
      ? q2ObsSwitch.value.trim()                                         // observações sobre switches
      : null;

  // Quantitativo 03 – Cabeamento Óptico
  payload.q3_tipo_fibra = q3TipoFibra ? q3TipoFibra.value || null : null;    // tipo de fibra (SM/OMx)
  payload.q3_qtd_fibras_por_cabo = intOrNullFromInput(q3QtdFibrasPorCabo);  // número de fibras por cabo
  payload.q3_tipo_conector = q3TipoConector ? q3TipoConector.value || null : null; // tipo de conector (LC/SC etc.)

  payload.q3_novo_dio = q3NovoDio
    ? selectSimNaoParaBoolean(q3NovoDio)                                    // converte "sim"/"nao" em boolean para novo DIO
    : null;
  payload.q3_caixa_terminacao = q3CaixaTerminacao
    ? selectSimNaoParaBoolean(q3CaixaTerminacao)                            // converte "sim"/"nao" em boolean para caixa de terminação
    : null;

  payload.q3_caixa_emenda = q3CaixaEmenda
    ? selectSimNaoParaBoolean(q3CaixaEmenda)                                // converte "sim"/"nao" em boolean para caixa de emenda
    : null;

  payload.q3_qtd_cabos = intOrNullFromInput(q3QtdCabos);                    // quantidade de cabos ópticos
  payload.q3_tamanho_total_m = floatOrNullFromInput(q3TamanhoTotal);        // metragem total em metros             // quantidade total de fibras
  payload.q3_qtd_cordoes_opticos = intOrNullFromInput(q3QtdCordoesOpticos); // quantidade de cordões ópticos

  let marcaCaboOpticoFinal = null;                                             // variável que guardará o valor final da marca óptica

  if (q3MarcaCabOptico) {                                                      // se o select de marca óptica existir
    const valorSelectMarcaOptica = q3MarcaCabOptico.value;                     // lê o valor selecionado no combo

    if (!valorSelectMarcaOptica) {                                             // se nada foi selecionado
      marcaCaboOpticoFinal = null;                                             // não envia valor
    } else if (valorSelectMarcaOptica === "outro") {                           // se a opção for "Outro"
      const textoOutroMarcaOptica =                                           // pega o texto do campo "Outro"
        q3MarcaCabOpticoOutroInput && q3MarcaCabOpticoOutroInput.value
          ? q3MarcaCabOpticoOutroInput.value.trim()
          : "";

      marcaCaboOpticoFinal = textoOutroMarcaOptica                             // se tiver texto
        ? `Outro: ${textoOutroMarcaOptica}`                                    // envia no formato "Outro: <texto>"
        : null;                                                                // se não tiver texto, envia null
    } else {                                                                   // se for uma das opções fixas
      marcaCaboOpticoFinal = valorSelectMarcaOptica;                           // usa o valor selecionado diretamente
    }
  }

  payload.q3_marca_cab_optico = marcaCaboOpticoFinal;                          // atribui o valor final ao payload

  payload.q3_modelo_dio =
    q3ModeloDio && q3ModeloDio.value.trim()
      ? q3ModeloDio.value.trim()                                            // modelo do DIO
      : null;

  payload.q3_modelo_cordao_optico =
    q3ModeloCordaoOptico && q3ModeloCordaoOptico.value.trim()
      ? q3ModeloCordaoOptico.value.trim()                                   // modelo do cordão óptico
      : null;

  payload.q3_observacoes =
    q3Obs && q3Obs.value.trim()
      ? q3Obs.value.trim()                                                  // observações sobre a rede óptica
      : null;

  // Quantitativo 04 – Equipamentos (flags principais)
  payload.q4_camera = q4Camera
    ? selectSimNaoParaBoolean(q4Camera)                               // converte "sim"/"nao" em boolean para flag de câmera
    : null;
  payload.q4_nvr_dvr = q4NvrDvr
    ? selectSimNaoParaBoolean(q4NvrDvr)                               // converte "sim"/"nao" em boolean para flag de NVR/DVR
    : null;

  // Quantitativo 04 – Equipamentos (detalhes de câmeras / NVR / conversor / GBIC)
  payload.q4_camera_nova = q4CameraNova
    ? selectSimNaoParaBoolean(q4CameraNova)                           // converte "sim"/"nao" em boolean para "câmera nova/realocação?"
    : null;

  payload.q4_camera_fornecedor =
    q4CameraFornecedor && q4CameraFornecedor.value
      ? q4CameraFornecedor.value                                      // "quotation_evaluation" ou "cliente"
      : null;

  payload.q4_camera_modelo =
    q4CameraModelo && q4CameraModelo.value.trim()
      ? q4CameraModelo.value.trim()                                   // modelo da câmera
      : null;

  payload.q4_camera_qtd = intOrNullFromInput(q4CameraQtd);            // quantidade de câmeras

  payload.q4_nvr_dvr_modelo =
    q4NvrDvrModelo && q4NvrDvrModelo.value.trim()
      ? q4NvrDvrModelo.value.trim()                                   // modelo do NVR/DVR
      : null;

  // Quantitativo 05 – Infraestrutura (flags)
  payload.q5_nova_eletrocalha = q5NovaEletrocalha
    ? selectSimNaoParaBoolean(q5NovaEletrocalha)                       // converte "sim"/"nao" em boolean p/ nova eletrocalha
    : null;
  payload.q5_novo_eletroduto = q5NovoEletroduto
    ? selectSimNaoParaBoolean(q5NovoEletroduto)                        // converte "sim"/"nao" em boolean p/ novo eletroduto
    : null;
  payload.q5_novo_rack = q5NovoRack
    ? selectSimNaoParaBoolean(q5NovoRack)                              // converte "sim"/"nao" em boolean p/ novo rack
    : null;
  payload.q5_instalacao_eletrica = q5InstalacaoEletrica
    ? selectSimNaoParaBoolean(q5InstalacaoEletrica)                    // converte "sim"/"nao" em boolean p/ instalação elétrica
    : null;
  payload.q5_nobreak = q5Nobreak
    ? selectSimNaoParaBoolean(q5Nobreak)                               // converte "sim"/"nao" em boolean p/ nobreak
    : null;
  payload.q5_serralheria = q5Serralheria
    ? selectSimNaoParaBoolean(q5Serralheria)                           // converte "sim"/"nao" em boolean p/ serralheria
    : null;

  // Quantitativo 05 – Infraestrutura (detalhes)
  payload.q5_eletrocalha_modelo =
    q5EletrocalhaModelo && q5EletrocalhaModelo.value.trim()
      ? q5EletrocalhaModelo.value.trim()                               // modelo da eletrocalha (texto)
      : null;
  payload.q5_eletrocalha_qtd = intOrNullFromInput(q5EletrocalhaQtd);   // quantidade de eletrocalhas

  payload.q5_eletroduto_modelo =
    q5EletrodutoModelo && q5EletrodutoModelo.value.trim()
      ? q5EletrodutoModelo.value.trim()                                // modelo do eletroduto
      : null;
  payload.q5_eletroduto_qtd = intOrNullFromInput(q5EletrodutoQtd);     // quantidade de eletrodutos

  payload.q5_rack_modelo =
    q5RackModelo && q5RackModelo.value.trim()
      ? q5RackModelo.value.trim()                                      // modelo do rack
      : null;
  payload.q5_rack_qtd = intOrNullFromInput(q5RackQtd);                 // quantidade de racks

  payload.q5_nobreak_modelo =
    q5NobreakModelo && q5NobreakModelo.value.trim()
      ? q5NobreakModelo.value.trim()                                   // modelo do nobreak
      : null;
  payload.q5_nobreak_qtd = intOrNullFromInput(q5NobreakQtd);           // quantidade de nobreaks

  payload.q5_serralheria_descricao =
    q5SerralheriaDescricao && q5SerralheriaDescricao.value.trim()
      ? q5SerralheriaDescricao.value.trim()                            // descrição da serralheria
      : null;

  payload.q5_instalacao_eletrica_obs =
    q5InstalacaoEletricaObs && q5InstalacaoEletricaObs.value.trim()
      ? q5InstalacaoEletricaObs.value.trim()                           // observações de instalação elétrica
      : null;

  // Quantitativo 09 – Análise de Painel de Automação (Controle de Acesso)
  payload.q9_tensao_fonte = q9TensaoFonte?.value || null;
  payload.q9_tensao_fonte_outro = q9TensaoFonteOutro?.value?.trim() || null;
  payload.q9_novo_cabeamento = q9NovoCabeamento ? selectSimNaoParaBoolean(q9NovoCabeamento) : null;
  payload.q9_tipo_cabeamento = q9TipoCabeamento?.value || null;
  payload.q9_tipo_cabeamento_outro = q9TipoCabeamentoOutro?.value?.trim() || null;
  payload.q9_quantidade_metros = floatOrNullFromInput(q9QuantidadeMetros);

  // Q9 - Tabela de Materiais do Painel
  const q9Materiais = coletarQ9MateriaisPainelDoFormulario();
  payload.materiais_painel = q9Materiais.map(item => ({
    equipamento: item.componente?.trim() || "",
    modelo: item.modelo?.trim() || null,
    quantidade: parseInt(item.quantidade, 10) || 0,
    fabricante: item.fabricante?.trim() || null
  }));

  // Quantitativo 10 – Portas (Controle de Acesso)
  payload.q10_tipo_porta = q10TipoPorta?.value || null;
  payload.q10_servo_motor = q10ServoMotor ? selectSimNaoParaBoolean(q10ServoMotor) : null;
  payload.q10_servo_motor_qtd = intOrNullFromInput(q10ServoMotorQtd);
  payload.q10_ponto_eletrico_novo = q10PontoEletricoNovo ? selectSimNaoParaBoolean(q10PontoEletricoNovo) : null;
  payload.q10_suporte_eletroimã = q10SuporteEletroima ? selectSimNaoParaBoolean(q10SuporteEletroima) : null;
  payload.q10_suporte_eletroimã_qtd = intOrNullFromInput(q10SuporteEletroimaQtd);
  payload.q10_botoeira_saida = q10BotoeiraSaida ? selectSimNaoParaBoolean(q10BotoeiraSaida) : null;
  payload.q10_botoeira_saida_qtd = intOrNullFromInput(q10BotoeiraSaidaQtd);
  payload.q10_botoeira_emergencia = q10BotoeiraEmergencia ? selectSimNaoParaBoolean(q10BotoeiraEmergencia) : null;
  payload.q10_botoeira_emergencia_qtd = intOrNullFromInput(q10BotoeiraEmergenciaQtd);
  payload.q10_leitor_cartao = q10LeitorCartao ? selectSimNaoParaBoolean(q10LeitorCartao) : null;
  payload.q10_leitor_cartao_qtd = intOrNullFromInput(q10LeitorCartaoQtd);
  payload.q10_leitor_facial = q10LeitorFacial ? selectSimNaoParaBoolean(q10LeitorFacial) : null;
  payload.q10_leitor_facial_qtd = intOrNullFromInput(q10LeitorFacialQtd);
  payload.q10_sensor_presenca = q10SensorPresenca ? selectSimNaoParaBoolean(q10SensorPresenca) : null;
  payload.q10_sensor_presenca_qtd = intOrNullFromInput(q10SensorPresencaQtd);
  payload.q10_sensor_barreira = q10SensorBarreira ? selectSimNaoParaBoolean(q10SensorBarreira) : null;
  payload.q10_sensor_barreira_qtd = intOrNullFromInput(q10SensorBarreiraQtd);
  payload.q9_observacoes = q9Observacoes?.value?.trim() || null;
  payload.q10_observacoes = q10Observacoes?.value?.trim() || null;

  // Q10 – Novos campos (Expansão)
  // Eletroímã/Fechadura
  payload.q10_eletroimã_fechadura = q10EletroimãFechadura ? selectSimNaoParaBoolean(q10EletroimãFechadura) : null;
  payload.q10_eletroimã_fechadura_modelo = q10EletroimãFechaduraModelo?.value?.trim() || null;
  payload.q10_eletroimã_fechadura_qtd = intOrNullFromInput(q10EletroimãFechaduraQtd);

  // Mola Hidráulica
  payload.q10_mola_hidraulica = q10MolaHidraulica ? selectSimNaoParaBoolean(q10MolaHidraulica) : null;
  payload.q10_mola_hidraulica_tipo = q10MolaHidraulicaTipo?.value?.trim() || null;
  payload.q10_mola_hidraulica_qtd = intOrNullFromInput(q10MolaHidraulicaQtd);

  // Proteção Botoeira Emergência
  payload.q10_protecao_botoeira_emergencia_qtd = intOrNullFromInput(q10ProtecaoBotoeiraEmergenciaQtd);

  // Modelos dos campos Q10 existentes
  payload.q10_botoeira_saida_modelo = q10BotoeiraSaidaModelo?.value?.trim() || null;
  payload.q10_botoeira_emergencia_modelo = q10BotoeiraEmergenciaModelo?.value?.trim() || null;
  payload.q10_leitor_cartao_modelo = q10LeitorCartaoModelo?.value?.trim() || null;
  payload.q10_leitor_facial_modelo = q10LeitorFacialModelo?.value?.trim() || null;
  payload.q10_sensor_presenca_modelo = q10SensorPresencaModelo?.value?.trim() || null;
  payload.q10_sensor_barreira_modelo = q10SensorBarreiraModelo?.value?.trim() || null;

  // Quantitativo 06 – Catracas, Torniquetes e Cancelas
  payload.q6_modelo = q6Modelo?.value?.trim() || null;
  payload.q6_quantidade = intOrNullFromInput(q6Quantidade);
  payload.q6_leitor_facial = q6LeitorFacial ? selectSimNaoParaBoolean(q6LeitorFacial) : null;
  payload.q6_leitor_facial_qtd = intOrNullFromInput(q6LeitorFacialQtd);
  payload.q6_suporte_leitor_facial = q6SuporteLeitorFacial ? selectSimNaoParaBoolean(q6SuporteLeitorFacial) : null;
  payload.q6_suporte_leitor_facial_qtd = intOrNullFromInput(q6SuporteLeitorFacialQtd);
  payload.q6_leitor_cartao = q6LeitorCartao ? selectSimNaoParaBoolean(q6LeitorCartao) : null;
  payload.q6_leitor_cartao_qtd = intOrNullFromInput(q6LeitorCartaoQtd);
  payload.q6_suporte_leitor_cartao = q6SuporteLeitorCartao ? selectSimNaoParaBoolean(q6SuporteLeitorCartao) : null;
  payload.q6_suporte_leitor_cartao_qtd = intOrNullFromInput(q6SuporteLeitorCartaoQtd);
  payload.q6_licenca_software = q6LicencaSoftware ? selectSimNaoParaBoolean(q6LicencaSoftware) : null;
  payload.q6_no_break = q6NoBreak ? selectSimNaoParaBoolean(q6NoBreak) : null;
  payload.q6_servidor = q6Servidor ? selectSimNaoParaBoolean(q6Servidor) : null;

  // Q6 – Novos campos (Expansão)
  // No-break e Servidor (campos modelo e quantidade)
  payload.q6_no_break_modelo = q6NoBreakModelo?.value?.trim() || null;
  payload.q6_no_break_qtd = intOrNullFromInput(q6NoBreakQtd);
  payload.q6_servidor_modelo = q6ServidorModelo?.value?.trim() || null;
  payload.q6_servidor_qtd = intOrNullFromInput(q6ServidorQtd);

  payload.q6_observacoes = q6Observacoes?.value?.trim() || null;

  // Imagens
  payload.localizacao_imagem1_url = imgRef1 ? imgRef1.value || null : null; // primeira imagem (pode ser null)
  payload.localizacao_imagem2_url = imgRef2 ? imgRef2.value || null : null; // segunda imagem (pode ser null)

  // Pré-requisitos
  payload.pre_trabalho_altura = preTrabalhoAltura ? selectSimNaoParaBoolean(preTrabalhoAltura) : null;
  payload.pre_plataforma = prePlataforma ? selectSimNaoParaBoolean(prePlataforma) : null;
  payload.pre_plataforma_modelo = prePlataformaModelo.value;
  payload.pre_plataforma_dias = intOrNullFromInput(prePlataformaDias); // converte dias de uso da plataforma para número ou null
  payload.pre_fora_horario_comercial = preForaHorario ? selectSimNaoParaBoolean(preForaHorario) : null;
  payload.pre_veiculo_quotation_evaluation = preVeiculoEmpresa ? selectSimNaoParaBoolean(preVeiculoEmpresa) : null;
  payload.pre_container_materiais = preContainer ? selectSimNaoParaBoolean(preContainer) : null;

  // Horas - dias normais (Tabela 4)
  payload.encarregado_dias = encarregadoDiasInput ? (encarregadoDiasInput.value || null) : null;                 // dias de encarregado
  payload.instalador_dias = instaladorDiasInput ? (instaladorDiasInput.value || null) : null;                   // dias de instalador
  payload.auxiliar_dias = auxiliarDiasInput ? (auxiliarDiasInput.value || null) : null;                         // dias de auxiliar
  payload.tecnico_de_instalacao_dias = tecnicoInstalacaoDiasInput ? (tecnicoInstalacaoDiasInput.value || null) : null; // dias do técnico de instalação
  payload.tecnico_em_seguranca_dias = tecnicoSegurancaDiasInput ? (tecnicoSegurancaDiasInput.value || null) : null;   // dias do técnico em segurança

  // Horas extras por função
  payload.encarregado_hora_extra = encarregadoHoraExtraInput ? (encarregadoHoraExtraInput.value || null) : null;                 // horas extras do encarregado
  payload.instalador_hora_extra = instaladorHoraExtraInput ? (instaladorHoraExtraInput.value || null) : null;                   // horas extras do instalador
  payload.auxiliar_hora_extra = auxiliarHoraExtraInput ? (auxiliarHoraExtraInput.value || null) : null;                         // horas extras do auxiliar
  payload.tecnico_de_instalacao_hora_extra = tecnicoInstalacaoHoraExtraInput ? (tecnicoInstalacaoHoraExtraInput.value || null) : null; // horas extras do técnico de instalação
  payload.tecnico_em_seguranca_hora_extra = tecnicoSegurancaHoraExtraInput ? (tecnicoSegurancaHoraExtraInput.value || null) : null;   // horas extras do técnico em segurança

  // Trabalho em domingos/feriados por função
  payload.encarregado_trabalho_domingo = encarregadoDomingoInput ? (encarregadoDomingoInput.value || null) : null;                 // domingos/feriados do encarregado
  payload.instalador_trabalho_domingo = instaladorDomingoInput ? (instaladorDomingoInput.value || null) : null;                   // domingos/feriados do instalador
  payload.auxiliar_trabalho_domingo = auxiliarDomingoInput ? (auxiliarDomingoInput.value || null) : null;                         // domingos/feriados do auxiliar
  payload.tecnico_de_instalacao_trabalho_domingo = tecnicoInstalacaoDomingoInput ? (tecnicoInstalacaoDomingoInput.value || null) : null; // domingos/feriados do técnico de instalação
  payload.tecnico_em_seguranca_trabalho_domingo = tecnicoSegurancaDomingoInput ? (tecnicoSegurancaDomingoInput.value || null) : null;   // domingos/feriados do técnico em segurança

  // Prazos
  payload.cronograma_execucao = selectSimNaoParaBoolean(cronogramaExecucaoSelect);           // converte "sim"/"nao" do select em boolean
  payload.dias_instalacao = diasInstalacaoInput ? (diasInstalacaoInput.value || null) : null; // número de dias de instalação
  payload.as_built = selectSimNaoParaBoolean(asBuiltSelect);                                 // converte select de As Built em boolean
  payload.dias_entrega_relatorio = diasEntregaRelatorioInput ? (diasEntregaRelatorioInput.value || null) : null; // prazo em dias para relatório
  payload.art = selectSimNaoParaBoolean(artSelect);                                          // converte select de ART em boolean

  // Alimentação
  payload.almoco_qtd = almocoQtdInput
    ? almocoQtdInput.value || null
    : null; // quantidade de almoços (mantém a mesma lógica, apenas ajustada em mais linhas)
  payload.lanche_qtd = lancheQtdInput
    ? lancheQtdInput.value || null
    : null; // quantidade de lanches (idem)

  const itensMateriaisInfra = coletarListaMateriaisInfraDoFormulario(); // obtém a lista de materiais de infraestrutura preenchida na tabela dinâmica

  listaMateriaisInfraParaApi = []; // zera explicitamente o array que será enviado ao backend para evitar resíduos de chamadas anteriores

  if (itensMateriaisInfra && itensMateriaisInfra.length > 0) { // se existir pelo menos um item na lista de materiais
    for (let i = 0; i < itensMateriaisInfra.length; i++) { // percorre a lista de materiais usando um índice numérico
      const item = itensMateriaisInfra[i]; // obtém o item atual da lista com base no índice

      const equipamento =
        item && item.equipamento
          ? item.equipamento.toString().trim()
          : ""; // normaliza o texto do campo "Equipamento / material" (ou usa string vazia se não existir)

      const modelo =
        item && item.modelo
          ? item.modelo.toString().trim()
          : ""; // normaliza o texto do modelo indicado para o material, se houver

      const quantidadeStr =
        item && item.quantidade !== undefined && item.quantidade !== null
          ? item.quantidade.toString().trim()
          : ""; // garante que a quantidade seja tratada como string, mesmo que tenha sido salva como número

      const fabricante =
        item && item.fabricante
          ? item.fabricante.toString().trim()
          : ""; // normaliza o texto do fabricante, se informado

      if (!equipamento) { // se a linha tiver alguma coisa preenchida mas não tiver o equipamento/material informado
        avaliacaoFeedbackEl.textContent =
          'Preencha o campo "Equipamento / material" em todas as linhas da lista de materiais.'; // mensagem de erro indicando o campo faltante
        avaliacaoFeedbackEl.classList.add("form-error"); // aplica classe visual de erro ao feedback
        return; // interrompe o fluxo de salvamento antes de chamar a API
      }

      let quantidadeInt = null; // inicializa variável que guardará a quantidade convertida para número inteiro
      if (quantidadeStr !== "") { // se o usuário digitou alguma coisa no campo de quantidade
        const parsed = parseInt(quantidadeStr, 10); // tenta converter o texto em número inteiro na base decimal
        if (Number.isNaN(parsed) || parsed <= 0) { // se a conversão falhar ou for menor/igual a zero, a quantidade é inválida
          avaliacaoFeedbackEl.textContent =
            "Informe uma quantidade numérica válida (maior que zero) em todas as linhas da lista de materiais."; // mensagem de erro de validação de quantidade
          avaliacaoFeedbackEl.classList.add("form-error"); // aplica classe de erro
          return; // interrompe o fluxo de salvamento
        }
        quantidadeInt = parsed; // se tudo estiver ok, armazena o valor convertido como inteiro
      } else { // se o campo de quantidade estiver vazio
        avaliacaoFeedbackEl.textContent =
          "Informe a quantidade em todas as linhas preenchidas da lista de materiais."; // exige que a quantidade seja informada para linhas parcialmente preenchidas
        avaliacaoFeedbackEl.classList.add("form-error"); // aplica estilo visual de erro
        return; // interrompe o fluxo de salvamento
      }

      listaMateriaisInfraParaApi.push({
        equipamento: equipamento, // salva o nome do equipamento/material já normalizado
        modelo: modelo || null, // salva o modelo ou null caso o campo esteja em branco
        quantidade: quantidadeInt, // salva a quantidade já validada em formato inteiro
        fabricante: fabricante || null, // salva o fabricante ou null se o campo estiver em branco
      }); // adiciona o item convertido ao array final que será sincronizado com o backend
    }
  }

  if (salvarAvaliacaoButton) { // se o botão "Salvar avaliação" existir
    salvarAvaliacaoButton.disabled = true; // desabilita o botão para evitar múltiplos envios simultâneos
    salvarAvaliacaoButton.dataset.originalText =
      salvarAvaliacaoButton.textContent; // salva o texto atual do botão em um data-atributo para poder restaurar depois
    salvarAvaliacaoButton.classList.add("btn-loading"); // adiciona classe de loading
    salvarAvaliacaoButton.innerHTML = '<span class="btn-spinner"></span>Salvando...'; // spinner + texto
  }

  try {
    let avaliacaoSalva = null;              // inicializa variável que armazenará a resposta do backend ao criar ou atualizar a avaliação (inclusive o id)
    let mensagemSucessoAvaliacao = "";      // variável que guardará a mensagem de sucesso apropriada (criação ou edição) para exibir somente após todo o processo terminar

    if (!avaliacaoEmEdicaoId) { // se não há avaliação em edição, vamos criar uma nova

      avaliacaoSalva = await apiPostJson(
        "/avaliacoes",
        payload
      ); // envia o payload para o backend criando um novo registro e captura a resposta (incluindo o id da avaliação)

      mensagemSucessoAvaliacao =
        "Avaliação salva com sucesso."; // guarda a mensagem de sucesso apropriada para criação, mas sem exibir ainda

    } else { // se existe uma avaliação em edição
      // Se houver id em edição, fazemos um PUT (edição)
      avaliacaoSalva = await apiPutJson(
        `/avaliacoes/${avaliacaoEmEdicaoId}`,
        payload
      ); // envia o payload para atualizar a avaliação existente e captura a resposta (incluindo o id da avaliação)

      mensagemSucessoAvaliacao =
        "Avaliação atualizada com sucesso."; // guarda a mensagem de sucesso específica para edição, sem exibir imediatamente
    }

    const avaliacaoIdParaMateriais =
      avaliacaoSalva && typeof avaliacaoSalva.id === "number" // verifica se a resposta do backend traz um id numérico válido
        ? avaliacaoSalva.id // em caso positivo, usa o id retornado pelo backend (principalmente em criação)
        : avaliacaoEmEdicaoId; // se não houver id na resposta, usa o id que já estava em edição (cenário de atualização)

    if (avaliacaoIdParaMateriais) { // se foi possível determinar um id de avaliação para associar os materiais
      await salvarListaMateriaisInfraNoBackend(
        avaliacaoIdParaMateriais, // id da avaliação cujos materiais devem ser sincronizados
        listaMateriaisInfraParaApi // lista de materiais que já foi validada e preparada para o backend
      ); // executa a estratégia "apagar tudo e recriar" para a lista de materiais desta avaliação

      await sincronizarImagensQ2SwitchNoBackend( // sincroniza as fotos do Q2 (switch) no backend (upload real + tabela)
        avaliacaoIdParaMateriais                 // passa o mesmo id da avaliação já salvo
      );                                         // fim sync imagens Q2

      await sincronizarImagensLocalizacaoNoBackend( // sincroniza as fotos de Localização no backend
        avaliacaoIdParaMateriais                    // passa o mesmo id da avaliação já salvo
      );                                            // fim sync imagens Localização
    }

    if (mensagemSucessoAvaliacao) {                              // verifica se alguma mensagem de sucesso foi definida durante o fluxo
      avaliacaoFeedbackEl.textContent = mensagemSucessoAvaliacao; // aplica o texto de sucesso no elemento de feedback
      avaliacaoFeedbackEl.classList.remove("form-error");         // remove qualquer classe de erro que possa estar aplicada de tentativas anteriores
      avaliacaoFeedbackEl.classList.add("form-success");          // adiciona a classe de sucesso para estilizar positivamente a mensagem
    }

    if (rascunhoEmEdicaoId) { // se existe um rascunho vinculado ao formulário atual

      excluirRascunhoLocalPorId(rascunhoEmEdicaoId); // remove do localStorage o rascunho correspondente
      rascunhoEmEdicaoId = null; // zera a referência global ao rascunho em edição, pois os dados já foram salvos no servidor
      renderizarListaRascunhos(); // atualiza a tabela de "Rascunhos locais" para refletir a remoção
    }

    formAvaliacao.reset(); // limpa todos os campos do formulário após salvar
    resetarFormularioParaNovaAvaliacao(); // volta o formulário para o modo "Nova Avaliação" (reseta estados internos)
    await carregarAvaliacoes(); // recarrega a lista de avaliações para refletir o novo registro/edição

  } catch (err) {
    console.error(err); // registra o erro no console para inspeção no navegador

    // Mensagens diferentes dependendo se era criação ou edição
    if (!avaliacaoEmEdicaoId) { // se não havia id em edição, o erro foi ao criar
      avaliacaoFeedbackEl.textContent =
        "Erro ao salvar avaliação. Verifique os dados e tente novamente."; // mensagem de erro para criação
    } else { // se havia id em edição, o erro foi ao atualizar
      avaliacaoFeedbackEl.textContent =
        "Erro ao atualizar avaliação. Verifique os dados e tente novamente."; // mensagem de erro para edição
    }

    avaliacaoFeedbackEl.classList.add("form-error"); // aplica classe de estilo de erro
  } finally {
    if (salvarAvaliacaoButton) { // garante que o botão será reabilitado após a tentativa de salvar
      salvarAvaliacaoButton.disabled = false; // reabilita o botão de salvar para próximas interações
      salvarAvaliacaoButton.classList.remove("btn-loading"); // remove classe de loading
      salvarAvaliacaoButton.textContent =
        salvarAvaliacaoButton.dataset.originalText ||
        "Salvar avaliação"; // restaura o texto original ou usa um texto padrão
    }
  }
}

// ----------------------------------------------------------------------
// Inicialização da página e registro de eventos
// ----------------------------------------------------------------------

/**
 * Registra todos os listeners necessários (submit de formulários,
 * clique em botões, etc.).
 */
function registrarEventos() {
  // Evento de submit do formulário de login
  if (loginForm) { // se o formulário de login existir na página
      loginForm.addEventListener("submit", async (event) => { // registra um listener assíncrono para o envio do formulário
        event.preventDefault(); // evita o recarregamento padrão da página

        // Lê usuário e senha digitados
        const username = loginUsernameInput.value.trim(); // obtém o texto do campo de usuário, removendo espaços extras nas pontas
        const password = loginPasswordInput.value.trim(); // obtém o texto do campo de senha, também removendo espaços extras

        // Validações simples
        if (!username || !password) { // se usuário ou senha estiverem vazios
          loginErrorEl.textContent = "Informe usuário e senha."; // exibe mensagem de erro de validação na tela de login
          return; // interrompe o fluxo sem chamar a API
        }

        // Timer para mostrar mensagem de servidor inicializando se demorar
        let serverSleepTimerId = null;

        if (loginSubmitButton) { // se o botão de submit de login foi encontrado no DOM
          loginSubmitButton.disabled = true; // desabilita o botão para evitar múltiplos cliques seguidos
          loginSubmitButton.dataset.originalText =
            loginSubmitButton.textContent; // guarda o texto original do botão em um data-atributo para restaurar depois
          loginSubmitButton.classList.add("btn-loading"); // adiciona classe de loading
          loginSubmitButton.innerHTML = '<span class="btn-spinner"></span>Entrando...'; // spinner + texto

          // Após 4 segundos, mostra mensagem de servidor inicializando
          serverSleepTimerId = setTimeout(() => {
            if (loginSubmitButton.disabled) { // só atualiza se ainda estiver carregando
              loginSubmitButton.innerHTML = '<span class="btn-spinner"></span>Servidor inicializando...';
              // Mostra mensagem adicional abaixo do botão
              if (loginErrorEl) {
                loginErrorEl.textContent = "";
                loginErrorEl.classList.remove("form-error");
                loginErrorEl.innerHTML = '<span style="color: #ffffff; font-size: 0.85rem;">⏳ O servidor pode demorar até 50s para inicializar na primeira conexão do dia.</span>';
              }
            }
          }, 4000);
        }

        try { // bloco try para garantir que o botão será reabilitado independente de sucesso ou erro
          await realizarLogin(username, password); // chama a função que faz a requisição de login e aguarda a resposta
        } finally { // sempre executado ao final da operação, com erro ou sucesso
          // Limpa o timer de mensagem de servidor dormindo
          if (serverSleepTimerId) {
            clearTimeout(serverSleepTimerId);
          }

          if (loginSubmitButton) { // se o botão ainda existir
            loginSubmitButton.disabled = false; // reabilita o botão de login
            loginSubmitButton.classList.remove("btn-loading"); // remove classe de loading
            loginSubmitButton.textContent =
              loginSubmitButton.dataset.originalText || "Entrar"; // restaura o texto original ou usa um texto padrão
          }
        }
      });
    }

  // ================== LOGIN OFFLINE ==================

  if (btnLoginOffline) {
    btnLoginOffline.addEventListener("click", () => {
      entrarModoOffline(); // função que configura o modo offline e mostra a tela principal
    });
  }

  // ================== LOGIN: AVISO DE CAPS LOCK ==================

  if (loginPasswordInput && loginCapsLockWarningEl) {              /* se o input e o aviso existirem */
    const atualizarAvisoCapsLock = (event) => {                    /* função que mostra/esconde o aviso */
      const capsAtivo =
        !!event && typeof event.getModifierState === "function" && event.getModifierState("CapsLock"); /* detecta CapsLock */
      loginCapsLockWarningEl.classList.toggle("hidden", !capsAtivo); /* mostra se ativo; esconde se não */
    };

    loginPasswordInput.addEventListener("keydown", atualizarAvisoCapsLock); /* atualiza ao pressionar */
    loginPasswordInput.addEventListener("keyup", atualizarAvisoCapsLock);   /* atualiza ao soltar */
    loginPasswordInput.addEventListener("blur", () => {                     /* ao sair do campo */
      loginCapsLockWarningEl.classList.add("hidden");                       /* esconde o aviso */
    });
  }

  if (q2NovoSwitch) {                                              // se o select "Necessita novo switch?" existir
    atualizarVisibilidadeFornecedorSwitch();                       // aplica o estado inicial do campo "Fornecedor do switch"
    q2NovoSwitch.addEventListener("change", () => {                // registra um listener para quando o usuário mudar o valor
      atualizarVisibilidadeFornecedorSwitch();                     // a cada mudança, atualiza a visibilidade do campo de fornecedor
    });
  }

  if(q4Camera){
    atualizarVisibilidadeCamera();
    q4Camera.addEventListener("change", () =>{
      atualizarVisibilidadeCamera();
    });
  }

  if(q4NvrDvr){
    atualizarVisibilidadeNvrdvr();
    q4NvrDvr.addEventListener("change", () =>{
      atualizarVisibilidadeNvrdvr();
    });
  }
  
  // Evento de clique no botão de logout (sair)
  if (logoutButton) {
    logoutButton.addEventListener("click", () => {
      realizarLogout();
    });
  }

  // Evento de clique no botão de recarregar lista de avaliações
  if (recarregarButton) {
    recarregarButton.addEventListener("click", () => {
      carregarAvaliacoes();
    });
  }

    // Evento de clique no botão "Usuários" (somente para administradores)
  if (openUsersButton) {                                              // verifica se o botão de gestão de usuários existe
    openUsersButton.addEventListener("click", () => {                 // registra o handler de clique
      abrirModalUsuarios();                                           // abre o modal de gestão de usuários
    });
  }

  // Evento de clique no botão de fechar o modal de usuários
  if (closeUsersButton) {                                             // verifica se o botão de fechar existe
    closeUsersButton.addEventListener("click", () => {                // registra o handler de clique
      fecharModalUsuarios();                                          // fecha o modal de gestão de usuários
    });
  }

  // Evento de submit do formulário de avaliação
  if (formAvaliacao) {                                            // verifica se o formulário de avaliação existe
    formAvaliacao.addEventListener("submit", salvarAvaliacao);    // registra o handler de submit para salvar a avaliação

    formAvaliacao.addEventListener("input", () => {               // registra um listener genérico para qualquer alteração nos campos do formulário
      agendarAutoSalvarRascunho();                                // sempre que o usuário digitar ou alterar algo, agenda o salvamento automático do rascunho
    });
  }

  if (salvarAvaliacaoButton) {                                    // verifica se o botão de salvar avaliação existe
    salvarAvaliacaoButton.addEventListener("click", (event) => {  // registra o handler de clique no botão "Salvar avaliação"
      event.preventDefault();                                     // evita o comportamento padrão de submit do formulário
      salvarAvaliacao(event);                                     // chama a função de salvar avaliação manualmente
    });
  }

  if (salvarRascunhoButton) {                                     // verifica se o botão de salvar rascunho existe no DOM
    salvarRascunhoButton.addEventListener("click", (event) => {   // registra o handler de clique no botão "Salvar rascunho"
      event.preventDefault();                                     // impede que o clique dispare um submit do formulário
      salvarRascunhoAtual();                                      // chama a função que salva o formulário como rascunho local
      renderizarListaRascunhos();                                 // atualiza a tabela de rascunhos após o salvamento
    });
  }

  if (rascunhosTbody) {                                           // garante que o corpo da tabela de rascunhos exista
    rascunhosTbody.addEventListener("click", (event) => {         // registra um único listener de clique (delegado) para a tabela
      const botao = event.target.closest("button[data-rascunho-id]"); // tenta encontrar o botão mais próximo com o data-rascunho-id
      if (!botao) {                                               // se o clique não ocorreu em um botão com esse atributo
        return;                                                   // não faz nada e encerra o handler
      }

      const idRascunho = botao.dataset.rascunhoId;                // lê o id do rascunho a partir do data-atributo do botão
      const acao = botao.dataset.action;                          // lê a ação solicitada (no momento, usamos apenas "excluir-rascunho")

      if (!idRascunho || acao !== "excluir-rascunho") {           // se não houver id válido ou a ação não for de exclusão
        return;                                                   // não executa nenhuma ação para este clique
      }

      excluirRascunhoLocalPorId(idRascunho);                      // remove o rascunho do armazenamento local

      if (rascunhoEmEdicaoId === idRascunho) {                    // se o rascunho excluído era o que estava vinculado ao formulário
        rascunhoEmEdicaoId = null;                                // zera o vínculo de rascunho atual
      }

      renderizarListaRascunhos();                                 // redesenha a lista de rascunhos para refletir a exclusão
    });
  }

  if (recarregarRascunhosButton) {                                // se o botão de recarregar rascunhos existir
    recarregarRascunhosButton.addEventListener("click", () => {   // registra o handler de clique nesse botão
      renderizarListaRascunhos();                                 // simplesmente re-renderiza a lista de rascunhos a partir do storage
    });
  }

  if (limparRascunhosButton) {                             
    limparRascunhosButton.addEventListener("click", () => {
        //const valorBruto = window.localStorage.getItem(DRAFTS_STORAGE_KEY); // lê a string JSON armazenada sob a chave de rascunhos
        window.localStorage.clear(); //limpar para debug
        renderizarListaRascunhos();                                 // simplesmente re-renderiza a lista de rascunhos a partir do storage
        atualizarBadgeRascunhos(0);                       // depois de limpar, zera o contador na badge
    });
  }

  // Salvamento automático silencioso quando o usuário tenta sair da página
  // MELHORIA: Só salva se o formulário NÃO estiver vazio, evitando rascunhos fantasmas
  window.addEventListener("beforeunload", () => {                 // registra um listener para o evento de saída/recarga da página
    try {
      if (!formAvaliacao) return;                                 // se não houver formulário, não há o que salvar
      
      // Coleta os valores e verifica se o formulário está vazio antes de salvar
      const campos = formAvaliacao.querySelectorAll("input, select, textarea");
      const valores = {};
      campos.forEach((campo) => {
        if (!campo.id) return;
        if (campo.type === "checkbox") {
          valores[campo.id] = campo.checked;
          return;
        }
        valores[campo.id] = campo.value;
      });
      
      // Só salva se o formulário tiver algum conteúdo relevante
      if (!formularioRascunhoEstaVazio(valores)) {
        salvarRascunhoAutomatico();                               // tenta salvar o estado atual do formulário como rascunho local
      }
    } catch (error) {
      // Em caso de erro, apenas registra no console; não deve bloquear a saída da página.
      console.error("Erro no salvamento automático de rascunho ao sair da página:", error); // loga o erro para diagnóstico
    }
  });

  if (clienteNomeInput) {                                         // se o select de cliente existir

    atualizarVisibilidadeClienteOutro();                          // aplica o estado inicial da visibilidade do campo "Outro"
    clienteNomeInput.addEventListener("change", () => {           // registra evento de mudança no select de cliente
      atualizarVisibilidadeClienteOutro();                        // ao mudar o valor, atualiza a visibilidade do campo "Outro"
    });
  }

  if (q1NovoPatch) {                                              // se o select "Necessita novo patch panel?" existir
    atualizarVisibilidadeModeloPatchPanel();                      // aplica o estado inicial da visibilidade do bloco de modelo
    q1NovoPatch.addEventListener("change", () => {                // registra evento de mudança nesse select
      atualizarVisibilidadeModeloPatchPanel();                    // ao mudar o valor, atualiza a visibilidade do bloco de modelo
    });
  }

  if (q1ModeloPatchPanel) {                                       // se o select de modelo de patch panel existir
    atualizarVisibilidadeModeloPatchPanelOutro();                 // ajusta a visibilidade do campo "Outro" de modelo
    q1ModeloPatchPanel.addEventListener("change", () => {         // registra evento de mudança no select de modelo
      atualizarVisibilidadeModeloPatchPanelOutro();               // ao mudar o valor, ajusta o campo "Outro" de modelo
    });
  }

  if (q1MarcaCab) {                                               // se o select de marca de cabeamento existir
    atualizarVisibilidadeMarcaCabOutro();                         // aplica o estado inicial de visibilidade do campo "Outro"
    q1MarcaCab.addEventListener("change", () => {                 // registra um listener para mudanças no select de marca
      atualizarVisibilidadeMarcaCabOutro();                       // ao mudar o valor, atualiza a visibilidade do campo "Outro"
    });                                                           // fim do addEventListener
  }                                                               // fim do if q1MarcaCab

  if (q1IncluirGuia) {                                              // se o select "Incluir guia de cabos?" existir
    atualizarVisibilidadeQtdGuiasCabos();                           // aplica o estado inicial ao carregar a página
    q1IncluirGuia.addEventListener("change", () => {                // registra um listener para mudanças no select
      atualizarVisibilidadeQtdGuiasCabos();                         // sempre que mudar, atualiza a visibilidade do campo de quantidade
    });
  }

  if (q3NovoDio) {                                                                 // se o select "Necessário novo DIO?" existir
    atualizarVisibilidadeModeloDio();                                              // aplica o estado inicial (útil na edição)
    q3NovoDio.addEventListener("change", () => {                                   // registra listener para mudanças no select
      atualizarVisibilidadeModeloDio();                                            // a cada mudança, atualiza a visibilidade do campo de modelo
    });
  }

    // Evento de clique no botão "Nova avaliação"
  if (novaAvaliacaoButton) {                                    // confere se o botão existe na página
    novaAvaliacaoButton.addEventListener("click", () => {       // registra o handler de clique
      if (formAvaliacao) {                                      // se o formulário estiver presente
        formAvaliacao.reset();                                  // limpa todos os campos do formulário
      }

      avaliacaoFeedbackEl.textContent = "";                     // limpa qualquer mensagem de feedback anterior
      avaliacaoFeedbackEl.className = "form-feedback";          // reseta as classes de erro/sucesso

      resetarFormularioParaNovaAvaliacao();                     // volta o estado interno para "Nova Avaliação"
      //tipo_formulario
      if (tipoFormularioInput) {                                      // se o campo hidden de tipo existir
        const tipoAtual = tipoFormularioInput.value || "utp_fibra";   // reaproveita o tipo atual ou assume "utp_fibra" como padrão
        aplicarVisibilidadeTipoFormulario(tipoAtual);                 // garante que os blocos exibidos correspondam ao tipo atual
      }
      //tipo_formulario
    });
    //tipo_formulario
    // Evento de mudança no dropdown de tipo de formulário
    if (tipoFormularioSelect) {
      tipoFormularioSelect.addEventListener("change", (e) => {
        const tipo = e.target.value || "utp_fibra";
        aplicarVisibilidadeTipoFormulario(tipo);
      });
    }

    // Define um tipo padrão e aplica visibilidade inicial ao carregar a tela
    if (tipoFormularioInput && !tipoFormularioInput.value) {               // se houver input hidden e ele ainda estiver vazio
      tipoFormularioInput.value = "utp_fibra";                             // define "utp_fibra" como tipo padrão
    }
    if (tipoFormularioInput) {                                             // se o input hidden existir
      aplicarVisibilidadeTipoFormulario(tipoFormularioInput.value);       // aplica a visibilidade inicial conforme o valor atual
    }
    //tipo_formulario

  }
  
  if (q3MarcaCabOptico) {                                                      // se o select de marca de cabo óptico existir
    atualizarVisibilidadeMarcaCaboOpticoOutro();                               // aplica o estado inicial da visibilidade do campo "Outro"
    q3MarcaCabOptico.addEventListener("change", () => {                        // registra um listener para mudança de valor
      atualizarVisibilidadeMarcaCaboOpticoOutro();                             // ao mudar a seleção, atualiza a visibilidade do campo "Outro"
    });
  }

  // Evento de submit do formulário de troca de senha (modal)
  if (passwordForm) {
    passwordForm.addEventListener("submit", enviarTrocaSenha);
  }

    // Evento de submit do formulário de gestão de usuários (apenas admins enxergam o card)
  if (userForm) {                                              // verifica se o formulário existe no DOM
    userForm.addEventListener("submit", salvarUsuario);        // associa o envio do formulário à função que cria usuários
  }

}

/**
 * Função chamada quando o DOM termina de carregar.
 * Verifica se já existe token salvo; se sim, tenta restaurar sessão.
 * Caso contrário, mostra a tela de login.
 */
async function inicializarApp() {
  // Registra listeners de eventos
  registrarEventos();

  inicializarListaMateriaisInfra(); // prepara a tabela de lista de materiais de infraestrutura (linhas iniciais e botão "Nova linha")
  inicializarTabelaQ9MateriaisPainel(); // prepara a tabela de materiais do painel Q9

  // Event listeners para campos condicionais Q9
  if (q9TensaoFonte) {
    q9TensaoFonte.addEventListener("change", atualizarVisibilidadeQ9TensaoFonteOutro);
  }
  if (q9NovoCabeamento) {
    q9NovoCabeamento.addEventListener("change", atualizarVisibilidadeQ9Cabeamento);
  }
  if (q9TipoCabeamento) {
    q9TipoCabeamento.addEventListener("change", atualizarVisibilidadeQ9TipoCabeamentoOutro);
  }

  // Event listeners para campos condicionais Q10
  if (q10TipoPorta) {
    q10TipoPorta.addEventListener("change", function() {
      atualizarVisibilidadeQ10ServoMotor();
      atualizarVisibilidadeQ10ServoMotorQtd();
    });
  }
  if (q10ServoMotor) {
    q10ServoMotor.addEventListener("change", atualizarVisibilidadeQ10ServoMotorQtd);
  }
  if (q10SuporteEletroima) {
    q10SuporteEletroima.addEventListener("change", atualizarVisibilidadeQ10SuporteEletroimaQtd);
  }
  if (q10BotoeiraSaida) {
    q10BotoeiraSaida.addEventListener("change", atualizarVisibilidadeQ10BotoeiraSaidaModeloQtd);
  }
  if (q10BotoeiraEmergencia) {
    q10BotoeiraEmergencia.addEventListener("change", atualizarVisibilidadeQ10BotoeiraEmergenciaModeloQtd);
  }
  if (q10LeitorCartao) {
    q10LeitorCartao.addEventListener("change", atualizarVisibilidadeQ10LeitorCartaoModeloQtd);
  }
  if (q10LeitorFacial) {
    q10LeitorFacial.addEventListener("change", atualizarVisibilidadeQ10LeitorFacialModeloQtd);
  }
  if (q10SensorPresenca) {
    q10SensorPresenca.addEventListener("change", atualizarVisibilidadeQ10SensorPresencaModeloQtd);
  }
  if (q10SensorBarreira) {
    q10SensorBarreira.addEventListener("change", atualizarVisibilidadeQ10SensorBarreiraModeloQtd);
  }

  // Event listeners para novos campos Q10 (Expansão)
  if (q10EletroimãFechadura) {
    q10EletroimãFechadura.addEventListener("change", atualizarVisibilidadeQ10EletroimãFechaduraModeloQtd);
  }
  if (q10MolaHidraulica) {
    q10MolaHidraulica.addEventListener("change", atualizarVisibilidadeQ10MolaHidraulicaTipoQtd);
  }

  // Event listeners para visibilidade condicional Q6
  if (q6LeitorFacial) {
    q6LeitorFacial.addEventListener("change", atualizarVisibilidadeQ6LeitorFacialQtd);
  }

  if (q6SuporteLeitorFacial) {
    q6SuporteLeitorFacial.addEventListener("change", atualizarVisibilidadeQ6SuporteLeitorFacialQtd);
  }

  if (q6LeitorCartao) {
    q6LeitorCartao.addEventListener("change", atualizarVisibilidadeQ6LeitorCartaoQtd);
  }

  if (q6SuporteLeitorCartao) {
    q6SuporteLeitorCartao.addEventListener("change", atualizarVisibilidadeQ6SuporteLeitorCartaoQtd);
  }

  // Tenta carregar token salvo no navegador
  const tokenSalvo = getStoredToken();

  // Verifica se este navegador já teve uma sessão autenticada em algum momento
  const jaTeveSessao =
    typeof localStorage !== "undefined" && // confere se o localStorage está disponível no ambiente
    localStorage.getItem(SESSION_MARKER_KEY) === "1"; // lê a chave de marcador de sessão e compara com "1"

  if (!tokenSalvo) {
    // Se não houver token salvo, verificamos se o navegador já teve sessão antes
    if (jaTeveSessao && loginErrorEl) {
      // Caso já tenha tido sessão, avisamos que a sessão expirou
      loginErrorEl.textContent =
        "Sua sessão expirou. Entre novamente para continuar."; // mensagem amigável de sessão expirada
    } else if (loginErrorEl) {
      // Se for o primeiro acesso (ou nunca marcou sessão), limpamos qualquer mensagem antiga
      loginErrorEl.textContent = ""; // garante que não haja erro “preso” de tentativas anteriores
    }

    // Em ambos os casos (com ou sem sessão anterior), mostramos a tela de login
    mostrarTelaLogin(); // exibe a tela de login como estado inicial
    return; // interrompe a inicialização, pois não temos usuário autenticado
  }

  // Se encontrou token, guardamos em memória
  setAuthToken(tokenSalvo);

  try {
    // Tentamos carregar dados do usuário com este token
    await carregarDadosUsuario();

    // Se deu certo, exibimos a tela principal
    mostrarTelaApp();

    // Carrega a lista de avaliações
    await carregarAvaliacoes();

    atualizarVisibilidadeGestaoUsuarios();                     // ajusta a área de gestão de usuários ao restaurar a sessão
    atualizarVisibilidadeBotaoAuditoria();                      // ajusta o botão de auditoria ao restaurar a sessão
    atualizarPermissaoStatus();                                 // ajusta permissão do campo status ao restaurar a sessão
    atualizarPermissaoCamposComerciais();                       // ajusta permissão dos campos comerciais ao restaurar a sessão
    atualizarVisibilidadeBotaoGerarLista();                     // ajusta visibilidade do botão de gerar lista de materiais ao restaurar a sessão

    resetarFormularioParaNovaAvaliacao(); // ajusta título/subtítulo e estado ao restaurar sessão com token salvo
    renderizarListaRascunhos(); // carrega também os rascunhos locais salvos para o usuário atual

    // Caso o usuário ainda precise trocar a senha, abrimos o modal
    if (currentUser && currentUser.precisa_trocar_senha) {
      abrirModalSenha();
    }
  } catch (err) {
    // Se qualquer erro acontecer (inclusive de autenticação), voltamos para login
    console.error(err);
    handleAuthError();
  }
}

/**
 * Registra eventos para a lista de materiais de infraestrutura.
 * - Teclado: ao pressionar Enter na última linha, cria uma nova linha automaticamente.
 * - Clique: ao clicar na lixeira, remove a linha correspondente.
 */
function registrarEventosListaMateriaisInfra() {
  if (!infraListaMateriaisTbody) {                                       // verifica se o corpo da tabela de materiais existe no DOM
    return;                                                              // se não existir (por alguma razão), encerra a função sem registrar eventos
  }

  infraListaMateriaisTbody.addEventListener("keydown", (event) => {      // adiciona um listener de tecla pressionada no corpo da tabela (event delegation)
    const alvo = event.target;                                           // captura o elemento que recebeu o foco e disparou o evento

    if (!alvo || alvo.tagName !== "INPUT") {                             // se não houver alvo ou se o alvo não for um campo de input
      return;                                                            // não fazemos nada (ignora teclas em outros elementos)
    }

    if (event.key !== "Enter") {                                         // verifica se a tecla pressionada é diferente de Enter
      return;                                                            // se não for Enter, não queremos interferir, então encerramos aqui
    }

    const linhaAtual = alvo.closest(".infra-lista-materiais-linha");     // busca a linha (tr) mais próxima que representa a linha de materiais atual
    if (!linhaAtual) {                                                   // se não encontrar uma linha correspondente
      return;                                                            // não há o que fazer, encerra o handler
    }

    const linhas = infraListaMateriaisTbody.querySelectorAll(            // busca todas as linhas de materiais atualmente na tabela
      ".infra-lista-materiais-linha"
    );
    if (!linhas || linhas.length === 0) {                                // se, por algum motivo, não houver linhas
      return;                                                            // encerra sem tentar criar nova linha
    }

    const ultimaLinha = linhas[linhas.length - 1];                       // considera a última linha da lista como referência

    if (linhaAtual === ultimaLinha) {                                    // se a linha em que o usuário está é a última linha da tabela
      event.preventDefault();                                            // impede o comportamento padrão do Enter (como submit do formulário)
      criarLinhaListaMateriaisInfra();                                   // chama a função que cria e adiciona uma nova linha à tabela (com foco no primeiro campo)
    }                                                                    // se não for a última linha, nada é feito (deixa o Enter ter efeito padrão, se houver)
  });

  infraListaMateriaisTbody.addEventListener("click", (event) => {        // adiciona um listener de clique no corpo da tabela (event delegation para os botões de lixeira)
    const alvo = event.target;                                           // captura o elemento exato em que o usuário clicou

    if (!alvo) {                                                         // se por algum motivo não houver alvo
      return;                                                            // encerra o handler sem fazer nada
    }

    const botaoRemover = alvo.closest(".infra-remover-linha");           // procura o ancestral mais próximo que tenha a classe do botão de remover linha
    if (!botaoRemover) {                                                 // se o clique não tiver ocorrido em um botão de remoção (ou dentro dele)
      return;                                                            // não faz nada e encerra o handler
    }

    event.preventDefault();                                              // evita qualquer comportamento padrão associado ao botão

    const linha = botaoRemover.closest(".infra-lista-materiais-linha");  // obtém a linha da tabela (tr) associada ao botão clicado
    if (!linha) {                                                        // se não foi possível encontrar a linha
      return;                                                            // encerra sem tentar remover
    }

    removerLinhaListaMateriaisInfra(linha);                              // chama o helper que trata a remoção (ou limpeza) da linha na tabela
  });
}

// Garante que inicializamos somente após o DOM estar pronto
document.addEventListener("DOMContentLoaded", () => {
  console.log("DOMContentLoaded executado");
  inicializarApp();                         // inicia a aplicação (login, carregamento de avaliações, etc.)
  registrarEventosListaMateriaisInfra();    // registra os eventos de teclado da lista de materiais de infraestrutura (Enter na última linha cria nova linha)
  inicializarFiltrosAvaliacoes();           // inicializa eventos dos filtros de avaliações registradas

  // Listener para atualizar campos comerciais quando status mudar
  const statusSelectEl = document.getElementById("status");
  if (statusSelectEl) {
    statusSelectEl.addEventListener("change", () => {
      atualizarPermissaoCamposComerciais(); // atualiza visibilidade quando status muda
    });
  }


  // ================== RASCUNHOS: TOGGLE DO ACCORDION ==================
  // Função de inicialização do comportamento de abre/fecha da seção de rascunhos
  (function initRascunhosToggle() {                            // IIFE para rodar assim que o script for carregado
    const rascunhosCard = document.querySelector('.card-list-rascunho'); // pega o card amarelo de rascunhos
    const toggleButton  = document.getElementById('btn-toggle-rascunhos'); // pega o botão que funciona como "aba"

    if (!rascunhosCard || !toggleButton) return;              // se por algum motivo não encontrar os elementos, sai silenciosamente

    toggleButton.addEventListener('click', () => {            // adiciona um ouvinte de clique no botão de toggle
      rascunhosCard.classList.toggle('rascunhos-collapsed');  // alterna a classe que colapsa/expande o painel
    });                                                       // fim da função de clique
  })();                                                       // executa imediatamente a função de inicialização

  // Listener do botão Exportar PDF
  const btnExportarPDF = document.getElementById("btn-exportar-pdf");
  if (btnExportarPDF) {
    btnExportarPDF.addEventListener("click", function () {
      // Só permite se for admin/comercial
      if (isAvaliador()) {
        if (avaliacaoFeedbackEl) {
          avaliacaoFeedbackEl.textContent = "Avaliadores não podem exportar PDF de avaliações.";
          avaliacaoFeedbackEl.className = "form-feedback form-error";
        }
        return;
      }
      // Se não houver avaliação registrada selecionada
      if (
        avaliacaoEmEdicaoId === null ||
        avaliacaoEmEdicaoCodigo === null ||
        typeof avaliacaoEmEdicaoCodigo !== "string" ||
        avaliacaoEmEdicaoCodigo.trim() === ""
      ) {
        if (avaliacaoFeedbackEl) {
          avaliacaoFeedbackEl.textContent = "Selecione uma avaliação registrada para exportar o PDF.";
          avaliacaoFeedbackEl.className = "form-feedback form-error";
        }
        return;
      }
      exportarAvaliacaoParaPDF();
    });
  }

});

// ================== RASCUNHOS: BADGE DE QUANTIDADE ==================

// Atualiza o número exibido na badge ao lado do título
function atualizarBadgeRascunhos(qtdRascunhos) {                  // recebe a quantidade de rascunhos
  const badge = document.getElementById('rascunhos-count-badge'); // pega o span da badge pelo id

  if (!badge) return;                                             // se não existir (HTML não foi renderizado), não faz nada

  const numero = Number(qtdRascunhos) || 0;                       // garante que a quantidade seja um número (fallback para 0)

  badge.textContent = numero.toString();                          // escreve o valor na badge como texto
}

// Versão que lê os rascunhos do usuário atual (consistente com a lista)
function atualizarBadgeRascunhosAPartirDoStorage() {              // função auxiliar para usar no fluxo atual
  try {                                                           // bloco try/catch para evitar quebrar a tela
    const rascunhosUsuario = obterRascunhosDoUsuarioAtual();      // usa a mesma função que a lista usa para filtrar
    const qtd = Array.isArray(rascunhosUsuario) ? rascunhosUsuario.length : 0; // conta apenas os visíveis
    atualizarBadgeRascunhos(qtd);                                 // chama a função que atualiza o texto da badge
  } catch (erro) {                                                // se der algum erro ao ler o storage
    console.error('Erro ao atualizar badge de rascunhos:', erro); // loga no console para debug
    atualizarBadgeRascunhos(0);                                   // garante que a badge não fique com lixo visual
  }
}


/**
 * Cria uma nova linha na lista de materiais de infraestrutura,
 * clonando a linha modelo existente no tbody e limpando seus campos.
 *
 * Parâmetro opcional:
 * - deveFocar (boolean): quando true, o foco vai para o primeiro input da nova linha.
 *   Usado em ações do usuário (Enter / botão "Nova linha").
 */
function criarLinhaListaMateriaisInfra({ deveFocar = true } = {}) {
  if (!infraListaMateriaisTbody) { // verifica se o corpo da tabela de materiais está disponível no DOM
    return null;                   // se não existir (por algum motivo), encerra a função retornando null
  }

  const linhaModelo = infraListaMateriaisTbody.querySelector(".infra-lista-materiais-linha"); // busca a primeira linha com a classe usada como modelo
  if (!linhaModelo) { // se nenhuma linha modelo for encontrada
    return null;      // não há como clonar, então encerra a função retornando null
  }

  const novaLinha = linhaModelo.cloneNode(true); // clona a linha modelo, incluindo toda a estrutura interna (células e inputs)

  const inputs = novaLinha.querySelectorAll("input"); // seleciona todos os inputs dentro da nova linha
  inputs.forEach((input) => { // percorre cada input encontrado na nova linha
    input.value = "";         // zera o valor do campo para que a nova linha comece vazia
  });

  infraListaMateriaisTbody.appendChild(novaLinha); // adiciona a nova linha ao final do corpo da tabela

  if (deveFocar) {                                      // verifica se a chamada solicitou mover o foco para a nova linha
    const primeiroInput = novaLinha.querySelector("input"); // busca o primeiro input da nova linha
    if (primeiroInput) {                             // se o primeiro input existir
      primeiroInput.focus();                         // move o foco para esse input para facilitar a digitação contínua
    }
  }

  return novaLinha; // retorna a referência da nova linha criada (caso alguém queira usar no futuro)
}


/**
 * Limpa completamente a tabela de materiais de infraestrutura,
 * preservando uma única linha vazia (a linha modelo).
 */
function limparTabelaMateriaisInfra() {
  if (!infraListaMateriaisTbody) { // verifica se o corpo da tabela está disponível
    return;                        // se não estiver, não há o que limpar e a função é encerrada
  }

  const linhas = infraListaMateriaisTbody.querySelectorAll(".infra-lista-materiais-linha"); // obtém todas as linhas de materiais atuais
  if (!linhas || linhas.length === 0) {                         // se não houver nenhuma linha encontrada
    criarLinhaListaMateriaisInfra({ deveFocar: false });        // cria uma linha nova sem focar, apenas para garantir que exista pelo menos uma linha editável
    return;                                                     // encerra após criar a nova linha
  }

  const primeiraLinha = linhas[0]; // considera a primeira linha como linha base/modelo a ser preservada

  const inputsPrimeiraLinha = primeiraLinha.querySelectorAll("input"); // seleciona todos os inputs da primeira linha
  inputsPrimeiraLinha.forEach((input) => { // percorre cada input da primeira linha
    input.value = "";                     // limpa o valor para que a linha fique completamente vazia
  });

  for (let i = 1; i < linhas.length; i++) {                        // percorre as demais linhas (a partir do índice 1)
    infraListaMateriaisTbody.removeChild(linhas[i]);               // remove cada linha extra do corpo da tabela
  }
}

/**
 * Inicializa o comportamento da lista de materiais de infraestrutura:
 * - garante que exista pelo menos uma linha na tabela;
 * - conecta o botão "Nova linha" para adicionar novas linhas.
 */
function inicializarListaMateriaisInfra() {
  if (!infraListaMateriaisTbody) { // verifica se o corpo da tabela existe na página atual
    return;                        // se não existir, significa que o formulário não está presente, então encerra
  }

  const linhaExistente = infraListaMateriaisTbody.querySelector(".infra-lista-materiais-linha"); // tenta localizar uma linha já definida no HTML
  if (!linhaExistente) {                              // se nenhuma linha for encontrada (cenário improvável, mas tratado por segurança)
    criarLinhaListaMateriaisInfra({ deveFocar: false }); // cria uma primeira linha vazia sem alterar o foco da página
  }

  if (infraAdicionarLinhaButton) {                                                // verifica se o botão "Nova linha" está presente no DOM
    infraAdicionarLinhaButton.addEventListener("click", () => {                   // registra o listener de clique no botão
      criarLinhaListaMateriaisInfra();                                            // ao clicar, cria e adiciona uma nova linha à tabela
    });
  }
}

function inicializarListaMateriaisInfra() {
  if (!infraListaMateriaisTbody) { // verifica se o corpo da tabela existe na página atual
    return;                        // se não existir, significa que o formulário não está presente, então encerra
  }

  const linhaExistente = infraListaMateriaisTbody.querySelector(".infra-lista-materiais-linha"); // tenta localizar uma linha já definida no HTML
  if (!linhaExistente) {          // se nenhuma linha for encontrada (cenário improvável, mas tratado por segurança)
    criarLinhaListaMateriaisInfra(); // cria uma primeira linha vazia para o usuário preencher
  }

  if (infraAdicionarLinhaButton) {                                                // verifica se o botão "Nova linha" está presente no DOM
    infraAdicionarLinhaButton.addEventListener("click", () => {                   // registra o listener de clique no botão
      criarLinhaListaMateriaisInfra();                                            // ao clicar, cria e adiciona uma nova linha à tabela
    });
  }
}

function inicializarTabelaQ9MateriaisPainel() {
  if (!q9MateriaisPainelTbody) return;

  const linhaExistente = q9MateriaisPainelTbody.querySelector(".q9-materiais-painel-linha");
  if (!linhaExistente) {
    criarLinhaQ9MateriaisPainel();
  }

  if (btnQ9AdicionarLinha) {
    btnQ9AdicionarLinha.addEventListener("click", () => {
      criarLinhaQ9MateriaisPainel();
    });
  }

  // Event listeners para botões de remover dentro da tabela (delegação de eventos)
  if (q9MateriaisPainelTbody) {
    q9MateriaisPainelTbody.addEventListener("click", (e) => {
      if (e.target.classList.contains("q9-remover-linha")) {
        const linha = e.target.closest(".q9-materiais-painel-linha");
        if (linha) removerLinhaQ9MateriaisPainel(linha);
      }
    });

    // Evento de tecla pressionada para adicionar nova linha ao pressionar Enter
    q9MateriaisPainelTbody.addEventListener("keydown", (event) => {      // adiciona um listener de tecla pressionada no corpo da tabela (event delegation)
      const alvo = event.target;                                           // captura o elemento que recebeu o foco e disparou o evento

      if (!alvo || alvo.tagName !== "INPUT") {                             // se não houver alvo ou se o alvo não for um campo de input
        return;                                                            // não fazemos nada (ignora teclas em outros elementos)
      }

      if (event.key !== "Enter") {                                         // verifica se a tecla pressionada é diferente de Enter
        return;                                                            // se não for Enter, não queremos interferir, então encerramos aqui
      }

      const linhaAtual = alvo.closest(".q9-materiais-painel-linha");      // busca a linha (tr) mais próxima que representa a linha de materiais atual
      if (!linhaAtual) {                                                   // se não encontrar uma linha correspondente
        return;                                                            // não há o que fazer, encerra o handler
      }

      const linhas = q9MateriaisPainelTbody.querySelectorAll(              // busca todas as linhas de materiais atualmente na tabela
        ".q9-materiais-painel-linha"
      );
      if (!linhas || linhas.length === 0) {                                // se, por algum motivo, não houver linhas
        return;                                                            // encerra sem tentar criar nova linha
      }

      const ultimaLinha = linhas[linhas.length - 1];                       // considera a última linha da lista como referência

      if (linhaAtual === ultimaLinha) {                                    // se a linha em que o usuário está é a última linha da tabela
        event.preventDefault();                                            // impede o comportamento padrão do Enter (como submit do formulário)
        criarLinhaQ9MateriaisPainel();                                     // chama a função que cria e adiciona uma nova linha à tabela (com foco no primeiro campo)
      }                                                                    // se não for a última linha, nada é feito (deixa o Enter ter efeito padrão, se houver)
    });
  }
}

/**
 * Coleta os dados da tabela de lista de materiais de infraestrutura
 * e devolve um array de objetos simples para uso em rascunhos ou envio à API.
 */
function coletarListaMateriaisInfraDoFormulario() {
  if (!infraListaMateriaisTbody) { // se o corpo da tabela não existir na página
    return []; // devolve um array vazio, pois não há lista de materiais para coletar
  }

  const linhas = infraListaMateriaisTbody.querySelectorAll(".infra-lista-materiais-linha"); // captura todas as linhas de materiais definidas na tabela
  const lista = []; // inicializa o array que acumulará os itens da lista de materiais

  linhas.forEach((linha) => { // percorre cada linha encontrada na tabela
    const inputEquipamento = linha.querySelector(".infra-lista-materiais-equipamento"); // localiza o campo de equipamento/material na linha
    const inputModelo = linha.querySelector(".infra-lista-materiais-modelo"); // localiza o campo de modelo na linha
    const inputQuantidade = linha.querySelector(".infra-lista-materiais-quantidade"); // localiza o campo de quantidade na linha
    const inputFabricante = linha.querySelector(".infra-lista-materiais-fabricante"); // localiza o campo de fabricante na linha

    const equipamento = inputEquipamento && inputEquipamento.value // verifica se o input de equipamento existe e possui algum valor
      ? inputEquipamento.value.trim() // se houver valor, normaliza removendo espaços nas extremidades
      : ""; // se não houver valor, usa string vazia

    const modelo = inputModelo && inputModelo.value // verifica se o input de modelo existe e possui algum valor
      ? inputModelo.value.trim() // normaliza o texto do modelo removendo espaços extras
      : ""; // se não houver valor, usa string vazia

    const quantidade = inputQuantidade && inputQuantidade.value // verifica se o input de quantidade existe e possui algum valor
      ? inputQuantidade.value.trim() // normaliza o texto da quantidade como string
      : ""; // se não houver valor, usa string vazia

    const fabricante = inputFabricante && inputFabricante.value // verifica se o input de fabricante existe e possui algum valor
      ? inputFabricante.value.trim() // normaliza o texto do fabricante removendo espaços nas extremidades
      : ""; // se não houver valor, usa string vazia

    const todosCamposVazios =
      !equipamento && !modelo && !quantidade && !fabricante; // verifica se todos os campos da linha estão vazios

    if (todosCamposVazios) { // se a linha estiver completamente vazia
      return; // ignora esta linha e segue para a próxima
    }

    lista.push({
      equipamento, // adiciona o valor do equipamento/material no objeto da linha
      modelo, // adiciona o modelo preenchido (se houver) no objeto da linha
      quantidade, // adiciona a quantidade como string (facilitando a edição futura no rascunho)
      fabricante, // adiciona o fabricante informado (se houver) no objeto da linha
    }); // insere o objeto desta linha no array principal de lista de materiais
  });

  return lista; // devolve o array de itens de materiais coletados da tabela
}

/**
 * Preenche a tabela de materiais de infraestrutura a partir de um array
 * previamente salvo (por exemplo, no rascunho local).
 */
function preencherListaMateriaisInfraAPartirDeDados(lista) {
  if (!infraListaMateriaisTbody) { // se o corpo da tabela não existir
    return; // não há onde preencher as linhas, então encerra a função
  }

  limparTabelaMateriaisInfra(); // limpa a tabela existente, deixando apenas uma linha vazia como base

  if (!Array.isArray(lista) || lista.length === 0) { // se não houver lista válida ou se o array estiver vazio
    return; // mantém apenas a linha vazia padrão e encerra a função
  }

  let primeiraLinha =
    infraListaMateriaisTbody.querySelector(".infra-lista-materiais-linha"); // obtém a linha base (primeira linha da tabela)

  lista.forEach((item, index) => { // percorre cada item do array de materiais recebido
    let linhaDestino = null; // variável que representará a linha em que os valores serão escritos

    if (index === 0 && primeiraLinha) {                 // se for o primeiro item e a linha base existir
      linhaDestino = primeiraLinha;                     // reutiliza a linha base existente para o primeiro item
    } else {
      linhaDestino = criarLinhaListaMateriaisInfra({    // para os itens seguintes, cria uma nova linha na tabela
        deveFocar: false,                               // evita mover o foco quando a tabela está sendo preenchida a partir de rascunho ou backend
      });
    }

    if (!linhaDestino) { // se por algum motivo não for possível obter/criar uma linha
      return; // interrompe o preenchimento para este item específico
    }

    const inputEquipamento = linhaDestino.querySelector(".infra-lista-materiais-equipamento"); // localiza o input de equipamento/material na linha
    const inputModelo = linhaDestino.querySelector(".infra-lista-materiais-modelo"); // localiza o input de modelo na linha
    const inputQuantidade = linhaDestino.querySelector(".infra-lista-materiais-quantidade"); // localiza o input de quantidade na linha
    const inputFabricante = linhaDestino.querySelector(".infra-lista-materiais-fabricante"); // localiza o input de fabricante na linha

    if (inputEquipamento) { // se o input de equipamento existir
      inputEquipamento.value = item && item.equipamento ? item.equipamento : ""; // escreve o valor de equipamento/material ou deixa em branco
    }

    if (inputModelo) { // se o input de modelo existir
      inputModelo.value = item && item.modelo ? item.modelo : ""; // escreve o valor de modelo ou deixa em branco
    }

    if (inputQuantidade) { // se o input de quantidade existir
      inputQuantidade.value = item && item.quantidade ? item.quantidade : ""; // escreve a quantidade ou deixa o campo vazio
    }

    if (inputFabricante) { // se o input de fabricante existir
      inputFabricante.value = item && item.fabricante ? item.fabricante : ""; // escreve o fabricante ou deixa o campo em branco
    }
  });
}

/**
 * Remove uma linha específica da lista de materiais de infraestrutura.
 * Se for a única linha existente, apenas limpa os campos ao invés de remover.
 */
function removerLinhaListaMateriaisInfra(linha) {
  if (!infraListaMateriaisTbody || !linha) {               // verifica se o corpo da tabela e a linha alvo existem
    return;                                                // se algum deles não existir, não há o que fazer
  }

  const linhas = infraListaMateriaisTbody.querySelectorAll(
    ".infra-lista-materiais-linha"
  );                                                       // obtém todas as linhas da tabela de materiais

  if (!linhas || linhas.length <= 1) {                     // se há zero ou apenas uma linha na tabela
    const inputs = linha.querySelectorAll("input");        // seleciona todos os inputs existentes nessa linha
    inputs.forEach((input) => {                            // percorre cada input da linha
      input.value = "";                                    // limpa o valor de cada campo, mantendo a linha vazia
    });
    return;                                                // encerra a função sem remover a linha do DOM
  }

  infraListaMateriaisTbody.removeChild(linha);             // se houver mais de uma linha, remove a linha alvo do corpo da tabela
}

// ================== Q9: TABELA DE MATERIAIS DO PAINEL ==================

function criarLinhaQ9MateriaisPainel({ deveFocar = true } = {}) {
  if (!q9MateriaisPainelTbody) return null;

  const linhaModelo = q9MateriaisPainelTbody.querySelector(".q9-materiais-painel-linha");
  if (!linhaModelo) return null;

  const novaLinha = linhaModelo.cloneNode(true);
  const inputs = novaLinha.querySelectorAll("input");
  inputs.forEach((input) => { input.value = ""; });

  q9MateriaisPainelTbody.appendChild(novaLinha);

  if (deveFocar) {
    const primeiroInput = novaLinha.querySelector("input");
    if (primeiroInput) primeiroInput.focus();
  }

  return novaLinha;  // RETORNA A NOVA LINHA CRIADA!
}

function removerLinhaQ9MateriaisPainel(linha) {
  if (!q9MateriaisPainelTbody || !linha) return;

  const linhas = q9MateriaisPainelTbody.querySelectorAll(".q9-materiais-painel-linha");

  if (!linhas || linhas.length <= 1) {
    const inputs = linha.querySelectorAll("input");
    inputs.forEach((input) => { input.value = ""; });
    return;
  }

  q9MateriaisPainelTbody.removeChild(linha);
}

function coletarQ9MateriaisPainelDoFormulario() {
  if (!q9MateriaisPainelTbody) return [];

  const linhas = q9MateriaisPainelTbody.querySelectorAll(".q9-materiais-painel-linha");
  const lista = [];

  linhas.forEach((linha, index) => {
    const inputComponente = linha.querySelector(".q9-materiais-painel-componente");
    const inputModelo = linha.querySelector(".q9-materiais-painel-modelo");
    const inputQuantidade = linha.querySelector(".q9-materiais-painel-quantidade");
    const inputFabricante = linha.querySelector(".q9-materiais-painel-fabricante");

    const componente = inputComponente?.value.trim() || "";
    const modelo = inputModelo?.value.trim() || "";
    const quantidade = inputQuantidade?.value.trim() || "";
    const fabricante = inputFabricante?.value.trim() || "";

    // Pula apenas linhas completamente vazias
    const todosCamposVazios = !componente && !modelo && !quantidade && !fabricante;
    if (todosCamposVazios) {
      return;
    }

    // Quantidade é obrigatória para adicionar à lista
    if (!quantidade) {
      return;
    }

    lista.push({
      componente: componente || "",
      modelo: modelo || null,
      quantidade: parseInt(quantidade, 10),
      fabricante: fabricante || null
    });
  });

  return lista;
}

function preencherQ9MateriaisPainelAPartirDeDados(lista) {
  limparTabelaQ9MateriaisPainel();

  if (!Array.isArray(lista) || lista.length === 0) {
    return;
  }

  lista.forEach((item, index) => {
    let linhaDestino = index === 0
      ? q9MateriaisPainelTbody.querySelector(".q9-materiais-painel-linha")
      : criarLinhaQ9MateriaisPainel({ deveFocar: false });

    if (!linhaDestino) {
      return;
    }

    const inputComponente = linhaDestino.querySelector(".q9-materiais-painel-componente");
    const inputModelo = linhaDestino.querySelector(".q9-materiais-painel-modelo");
    const inputQuantidade = linhaDestino.querySelector(".q9-materiais-painel-quantidade");
    const inputFabricante = linhaDestino.querySelector(".q9-materiais-painel-fabricante");

    if (inputComponente) inputComponente.value = item.componente || item.equipamento || "";
    if (inputModelo) inputModelo.value = item.modelo || "";
    if (inputQuantidade) inputQuantidade.value = item.quantidade || "";
    if (inputFabricante) inputFabricante.value = item.fabricante || "";
  });
}

function limparTabelaQ9MateriaisPainel() {
  if (!q9MateriaisPainelTbody) return;

  const linhas = q9MateriaisPainelTbody.querySelectorAll(".q9-materiais-painel-linha");

  if (linhas.length === 0) return;

  linhas.forEach((linha, index) => {
    if (index === 0) {
      const inputs = linha.querySelectorAll("input");
      inputs.forEach((input) => { input.value = ""; });
    } else {
      q9MateriaisPainelTbody.removeChild(linha);
    }
  });
}

// ================== Q9: FUNÇÕES DE VISIBILIDADE CONDICIONAL ==================

function atualizarVisibilidadeQ9TensaoFonteOutro() {
  if (!q9TensaoFonte || !q9TensaoFonteOutroWrapper) return;

  const valor = q9TensaoFonte.value;

  if (valor === "outro") {
    q9TensaoFonteOutroWrapper.classList.remove("invisible-keep-space");
  } else {
    q9TensaoFonteOutroWrapper.classList.add("invisible-keep-space");
    if (q9TensaoFonteOutro) q9TensaoFonteOutro.value = "";
  }
}

function atualizarVisibilidadeQ9Cabeamento() {
  if (!q9NovoCabeamento || !q9TipoCabeamentoWrapper || !q9QuantidadeMetrosWrapper) return;

  const valor = q9NovoCabeamento.value;

  if (valor === "sim") {
    q9TipoCabeamentoWrapper.classList.remove("invisible-keep-space");
    q9QuantidadeMetrosWrapper.classList.remove("invisible-keep-space");
  } else {
    q9TipoCabeamentoWrapper.classList.add("invisible-keep-space");
    q9QuantidadeMetrosWrapper.classList.add("invisible-keep-space");
    q9TipoCabeamentoOutroWrapper.classList.add("invisible-keep-space");

    if (q9TipoCabeamento) q9TipoCabeamento.value = "";
    if (q9TipoCabeamentoOutro) q9TipoCabeamentoOutro.value = "";
    if (q9QuantidadeMetros) q9QuantidadeMetros.value = "";
  }
}

function atualizarVisibilidadeQ9TipoCabeamentoOutro() {
  if (!q9TipoCabeamento || !q9TipoCabeamentoOutroWrapper) return;

  const valor = q9TipoCabeamento.value;

  if (valor === "outro") {
    q9TipoCabeamentoOutroWrapper.classList.remove("invisible-keep-space");
  } else {
    q9TipoCabeamentoOutroWrapper.classList.add("invisible-keep-space");
    if (q9TipoCabeamentoOutro) q9TipoCabeamentoOutro.value = "";
  }
}

// ==================  Q10 - Portas: Funções de Visibilidade ==================

function atualizarVisibilidadeQ10ServoMotor() {
  if (!q10TipoPorta || !q10ServoMotorWrapper || !q10ServoMotorQtdWrapper) return;

  const tipoPivotante = q10TipoPorta.value === "pivotante";

  if (tipoPivotante) {
    q10ServoMotorWrapper.classList.remove("invisible-keep-space");
  } else {
    q10ServoMotorWrapper.classList.add("invisible-keep-space");
    q10ServoMotorQtdWrapper.classList.add("invisible-keep-space");
    if (q10ServoMotor) q10ServoMotor.value = "";
    if (q10ServoMotorQtd) q10ServoMotorQtd.value = "";
  }
}

function atualizarVisibilidadeQ10ServoMotorQtd() {
  if (!q10ServoMotor || !q10ServoMotorQtdWrapper) return;

  if (q10ServoMotor.value === "sim") {
    q10ServoMotorQtdWrapper.classList.remove("invisible-keep-space");
  } else {
    q10ServoMotorQtdWrapper.classList.add("invisible-keep-space");
    if (q10ServoMotorQtd) q10ServoMotorQtd.value = "";
  }
}

function atualizarVisibilidadeQ10SuporteEletroimaQtd() {
  if (!q10SuporteEletroima || !q10SuporteEletroimaQtdWrapper) return;

  if (q10SuporteEletroima.value === "sim") {
    q10SuporteEletroimaQtdWrapper.classList.remove("invisible-keep-space");
  } else {
    q10SuporteEletroimaQtdWrapper.classList.add("invisible-keep-space");
    if (q10SuporteEletroimaQtd) q10SuporteEletroimaQtd.value = "";
  }
}

function atualizarVisibilidadeQ10BotoeiraSaidaQtd() {
  if (!q10BotoeiraSaida || !q10BotoeiraSaidaQtdWrapper) return;

  if (q10BotoeiraSaida.value === "sim") {
    q10BotoeiraSaidaQtdWrapper.classList.remove("invisible-keep-space");
  } else {
    q10BotoeiraSaidaQtdWrapper.classList.add("invisible-keep-space");
    if (q10BotoeiraSaidaQtd) q10BotoeiraSaidaQtd.value = "";
  }
}

function atualizarVisibilidadeQ10BotoeiraEmergenciaQtd() {
  if (!q10BotoeiraEmergencia || !q10BotoeiraEmergenciaQtdWrapper) return;

  if (q10BotoeiraEmergencia.value === "sim") {
    q10BotoeiraEmergenciaQtdWrapper.classList.remove("invisible-keep-space");
  } else {
    q10BotoeiraEmergenciaQtdWrapper.classList.add("invisible-keep-space");
    if (q10BotoeiraEmergenciaQtd) q10BotoeiraEmergenciaQtd.value = "";
  }
}

function atualizarVisibilidadeQ10LeitorCartaoQtd() {
  if (!q10LeitorCartao || !q10LeitorCartaoQtdWrapper) return;

  if (q10LeitorCartao.value === "sim") {
    q10LeitorCartaoQtdWrapper.classList.remove("invisible-keep-space");
  } else {
    q10LeitorCartaoQtdWrapper.classList.add("invisible-keep-space");
    if (q10LeitorCartaoQtd) q10LeitorCartaoQtd.value = "";
  }
}

function atualizarVisibilidadeQ10LeitorFacialQtd() {
  if (!q10LeitorFacial || !q10LeitorFacialQtdWrapper) return;

  if (q10LeitorFacial.value === "sim") {
    q10LeitorFacialQtdWrapper.classList.remove("invisible-keep-space");
  } else {
    q10LeitorFacialQtdWrapper.classList.add("invisible-keep-space");
    if (q10LeitorFacialQtd) q10LeitorFacialQtd.value = "";
  }
}

function atualizarVisibilidadeQ10SensorPresencaQtd() {
  if (!q10SensorPresenca || !q10SensorPresencaQtdWrapper) return;

  if (q10SensorPresenca.value === "sim") {
    q10SensorPresencaQtdWrapper.classList.remove("invisible-keep-space");
  } else {
    q10SensorPresencaQtdWrapper.classList.add("invisible-keep-space");
    if (q10SensorPresencaQtd) q10SensorPresencaQtd.value = "";
  }
}

function atualizarVisibilidadeQ10SensorBarreiraQtd() {
  if (!q10SensorBarreira || !q10SensorBarreiraQtdWrapper) return;

  if (q10SensorBarreira.value === "sim") {
    q10SensorBarreiraQtdWrapper.classList.remove("invisible-keep-space");
  } else {
    q10SensorBarreiraQtdWrapper.classList.add("invisible-keep-space");
    if (q10SensorBarreiraQtd) q10SensorBarreiraQtd.value = "";
  }
}

// ================== Q6: CATRACAS, TORNIQUETES E CANCELAS - VISIBILIDADE CONDICIONAL ==================

function atualizarVisibilidadeQ6LeitorFacialQtd() {
  if (!q6LeitorFacial || !q6LeitorFacialQtdWrapper) return;

  if (q6LeitorFacial.value === "sim") {
    q6LeitorFacialQtdWrapper.classList.remove("invisible-keep-space");
  } else {
    q6LeitorFacialQtdWrapper.classList.add("invisible-keep-space");
    if (q6LeitorFacialQtd) q6LeitorFacialQtd.value = "";
  }
}

function atualizarVisibilidadeQ6SuporteLeitorFacialQtd() {
  if (!q6SuporteLeitorFacial || !q6SuporteLeitorFacialQtdWrapper) return;

  if (q6SuporteLeitorFacial.value === "sim") {
    q6SuporteLeitorFacialQtdWrapper.classList.remove("invisible-keep-space");
  } else {
    q6SuporteLeitorFacialQtdWrapper.classList.add("invisible-keep-space");
    if (q6SuporteLeitorFacialQtd) q6SuporteLeitorFacialQtd.value = "";
  }
}

function atualizarVisibilidadeQ6LeitorCartaoQtd() {
  if (!q6LeitorCartao || !q6LeitorCartaoQtdWrapper) return;

  if (q6LeitorCartao.value === "sim") {
    q6LeitorCartaoQtdWrapper.classList.remove("invisible-keep-space");
  } else {
    q6LeitorCartaoQtdWrapper.classList.add("invisible-keep-space");
    if (q6LeitorCartaoQtd) q6LeitorCartaoQtd.value = "";
  }
}

function atualizarVisibilidadeQ6SuporteLeitorCartaoQtd() {
  if (!q6SuporteLeitorCartao || !q6SuporteLeitorCartaoQtdWrapper) return;

  if (q6SuporteLeitorCartao.value === "sim") {
    q6SuporteLeitorCartaoQtdWrapper.classList.remove("invisible-keep-space");
  } else {
    q6SuporteLeitorCartaoQtdWrapper.classList.add("invisible-keep-space");
    if (q6SuporteLeitorCartaoQtd) q6SuporteLeitorCartaoQtd.value = "";
  }
}

// ===== Novos campos Q10 (Expansão) =====
function atualizarVisibilidadeQ10EletroimãFechaduraModeloQtd() {
  if (!q10EletroimãFechadura || !q10EletroimãFechaduraModeloWrapper || !q10EletroimãFechaduraQtdWrapper) return;

  if (q10EletroimãFechadura.value === "sim") {
    q10EletroimãFechaduraModeloWrapper.classList.remove("invisible-keep-space");
    q10EletroimãFechaduraQtdWrapper.classList.remove("invisible-keep-space");
  } else {
    q10EletroimãFechaduraModeloWrapper.classList.add("invisible-keep-space");
    q10EletroimãFechaduraQtdWrapper.classList.add("invisible-keep-space");
    if (q10EletroimãFechaduraModelo) q10EletroimãFechaduraModelo.value = "";
    if (q10EletroimãFechaduraQtd) q10EletroimãFechaduraQtd.value = "";
  }
}

function atualizarVisibilidadeQ10MolaHidraulicaTipoQtd() {
  if (!q10MolaHidraulica || !q10MolaHidraulicaTipoWrapper || !q10MolaHidraulicaQtdWrapper) return;

  if (q10MolaHidraulica.value === "sim") {
    q10MolaHidraulicaTipoWrapper.classList.remove("invisible-keep-space");
    q10MolaHidraulicaQtdWrapper.classList.remove("invisible-keep-space");
  } else {
    q10MolaHidraulicaTipoWrapper.classList.add("invisible-keep-space");
    q10MolaHidraulicaQtdWrapper.classList.add("invisible-keep-space");
    if (q10MolaHidraulicaTipo) q10MolaHidraulicaTipo.value = "";
    if (q10MolaHidraulicaQtd) q10MolaHidraulicaQtd.value = "";
  }
}

// Atualizar funções existentes para incluir campo modelo
function atualizarVisibilidadeQ10BotoeiraSaidaModeloQtd() {
  if (!q10BotoeiraSaida || !q10BotoeiraSaidaModeloWrapper || !q10BotoeiraSaidaQtdWrapper) return;

  if (q10BotoeiraSaida.value === "sim") {
    q10BotoeiraSaidaModeloWrapper.classList.remove("invisible-keep-space");
    q10BotoeiraSaidaQtdWrapper.classList.remove("invisible-keep-space");
  } else {
    q10BotoeiraSaidaModeloWrapper.classList.add("invisible-keep-space");
    q10BotoeiraSaidaQtdWrapper.classList.add("invisible-keep-space");
    if (q10BotoeiraSaidaModelo) q10BotoeiraSaidaModelo.value = "";
    if (q10BotoeiraSaidaQtd) q10BotoeiraSaidaQtd.value = "";
  }
}

function atualizarVisibilidadeQ10BotoeiraEmergenciaModeloQtd() {
  if (!q10BotoeiraEmergencia || !q10BotoeiraEmergenciaModeloWrapper || !q10BotoeiraEmergenciaQtdWrapper) return;

  if (q10BotoeiraEmergencia.value === "sim") {
    q10BotoeiraEmergenciaModeloWrapper.classList.remove("invisible-keep-space");
    q10BotoeiraEmergenciaQtdWrapper.classList.remove("invisible-keep-space");
  } else {
    q10BotoeiraEmergenciaModeloWrapper.classList.add("invisible-keep-space");
    q10BotoeiraEmergenciaQtdWrapper.classList.add("invisible-keep-space");
    if (q10BotoeiraEmergenciaModelo) q10BotoeiraEmergenciaModelo.value = "";
    if (q10BotoeiraEmergenciaQtd) q10BotoeiraEmergenciaQtd.value = "";
  }
}

function atualizarVisibilidadeQ10LeitorCartaoModeloQtd() {
  if (!q10LeitorCartao || !q10LeitorCartaoModeloWrapper || !q10LeitorCartaoQtdWrapper) return;

  if (q10LeitorCartao.value === "sim") {
    q10LeitorCartaoModeloWrapper.classList.remove("invisible-keep-space");
    q10LeitorCartaoQtdWrapper.classList.remove("invisible-keep-space");
  } else {
    q10LeitorCartaoModeloWrapper.classList.add("invisible-keep-space");
    q10LeitorCartaoQtdWrapper.classList.add("invisible-keep-space");
    if (q10LeitorCartaoModelo) q10LeitorCartaoModelo.value = "";
    if (q10LeitorCartaoQtd) q10LeitorCartaoQtd.value = "";
  }
}

function atualizarVisibilidadeQ10LeitorFacialModeloQtd() {
  if (!q10LeitorFacial || !q10LeitorFacialModeloWrapper || !q10LeitorFacialQtdWrapper) return;

  if (q10LeitorFacial.value === "sim") {
    q10LeitorFacialModeloWrapper.classList.remove("invisible-keep-space");
    q10LeitorFacialQtdWrapper.classList.remove("invisible-keep-space");
  } else {
    q10LeitorFacialModeloWrapper.classList.add("invisible-keep-space");
    q10LeitorFacialQtdWrapper.classList.add("invisible-keep-space");
    if (q10LeitorFacialModelo) q10LeitorFacialModelo.value = "";
    if (q10LeitorFacialQtd) q10LeitorFacialQtd.value = "";
  }
}

function atualizarVisibilidadeQ10SensorPresencaModeloQtd() {
  if (!q10SensorPresenca || !q10SensorPresencaModeloWrapper || !q10SensorPresencaQtdWrapper) return;

  if (q10SensorPresenca.value === "sim") {
    q10SensorPresencaModeloWrapper.classList.remove("invisible-keep-space");
    q10SensorPresencaQtdWrapper.classList.remove("invisible-keep-space");
  } else {
    q10SensorPresencaModeloWrapper.classList.add("invisible-keep-space");
    q10SensorPresencaQtdWrapper.classList.add("invisible-keep-space");
    if (q10SensorPresencaModelo) q10SensorPresencaModelo.value = "";
    if (q10SensorPresencaQtd) q10SensorPresencaQtd.value = "";
  }
}

function atualizarVisibilidadeQ10SensorBarreiraModeloQtd() {
  if (!q10SensorBarreira || !q10SensorBarreiraModeloWrapper || !q10SensorBarreiraQtdWrapper) return;

  if (q10SensorBarreira.value === "sim") {
    q10SensorBarreiraModeloWrapper.classList.remove("invisible-keep-space");
    q10SensorBarreiraQtdWrapper.classList.remove("invisible-keep-space");
  } else {
    q10SensorBarreiraModeloWrapper.classList.add("invisible-keep-space");
    q10SensorBarreiraQtdWrapper.classList.add("invisible-keep-space");
    if (q10SensorBarreiraModelo) q10SensorBarreiraModelo.value = "";
    if (q10SensorBarreiraQtd) q10SensorBarreiraQtd.value = "";
  }
}

// ================== INÍCIO: SUPORTE DE AUDITORIA NO FRONT ==================

// Mapa em memória para recuperar dados de usuários pela chave id (apenas para exibir nomes nos logs)
let AUDIT_MAPA_USUARIOS = {}; // cria um objeto global onde a chave será o id do usuário e o valor será o próprio objeto de usuário

// Mapa em memória para recuperar dados de avaliações pela chave id (para exibir informações legíveis no select)
let AUDIT_MAPA_AVALIACOES = {}; // cria outro objeto global onde a chave será o id da avaliação e o valor será o objeto com dados da avaliação

// ================== INÍCIO: FILTROS DE AVALIAÇÕES REGISTRADAS ==================

// Array global para armazenar todas as avaliações carregadas (para filtragem local)
let TODAS_AVALIACOES = [];

// Função para popular o filtro 'Criado por' com nomes únicos
function popularFiltroCriadoPor(avaliacoes) {
  const select = document.getElementById("filtro-criado-por");
  if (!select) return;
  // Extrai nomes únicos, ignora vazios
  const nomes = Array.from(new Set(
    (avaliacoes || [])
      .map(a => a.criado_por_nome || "")
      .filter(n => n && n.trim() !== "")
  ));
  // Limpa e adiciona opção padrão
  select.innerHTML = '<option value="">-- Todos --</option>';
  nomes.sort((a, b) => a.localeCompare(b, 'pt-BR')).forEach(nome => {
    const opt = document.createElement('option');
    opt.value = nome;
    opt.textContent = nome;
    select.appendChild(opt);
  });
}

// Estado do painel de filtros (visível ou oculto)
let filtrosVisiveis = false;

// Alterna a visibilidade do painel de filtros
function toggleFiltrosAvaliacoes() {
  const container = document.getElementById("filtros-avaliacoes-container");
  const btnFiltros = document.getElementById("btn-filtros-avaliacoes");
  if (!container) return;
  
  filtrosVisiveis = !filtrosVisiveis;
  container.style.display = filtrosVisiveis ? "block" : "none";
  
  // Atualiza visual do botão para indicar estado
  if (btnFiltros) {
    btnFiltros.classList.toggle("btn-active", filtrosVisiveis);
  }

  // Ajusta o max-height do card para acomodar os filtros
  const cardAvaliacoes = container.closest(".card-max");
  if (cardAvaliacoes) {
    cardAvaliacoes.style.maxHeight = filtrosVisiveis ? "784px" : "392px";
  }
}

// Limpa todos os campos de filtro e reaplica os filtros (mostra tudo)
function limparFiltrosAvaliacoes() {
  const campos = [
    "filtro-codigo", "filtro-cliente", "filtro-objeto",
    "filtro-local", "filtro-status", "filtro-data",
    "filtro-solicitante", "filtro-email", "filtro-criado-por"
  ];
  campos.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      if (el.tagName === 'SELECT') {
        el.selectedIndex = 0;
      } else {
        el.value = "";
      }
    }
  });
  aplicarFiltrosAvaliacoes();
}

// Aplica os filtros e atualiza a tabela
function aplicarFiltrosAvaliacoes() {
  const filtroCodigo = (document.getElementById("filtro-codigo")?.value || "").toLowerCase().trim();
  const filtroCliente = (document.getElementById("filtro-cliente")?.value || "").toLowerCase().trim();
  const filtroObjeto = (document.getElementById("filtro-objeto")?.value || "").toLowerCase().trim();
  const filtroLocal = (document.getElementById("filtro-local")?.value || "").toLowerCase().trim();
  const filtroCriadoPor = (document.getElementById("filtro-criado-por")?.value || "").trim();
  const filtroStatus = (document.getElementById("filtro-status")?.value || "").toLowerCase().trim();
  const filtroData = (document.getElementById("filtro-data")?.value || "").trim();
  const filtroSolicitante = (document.getElementById("filtro-solicitante")?.value || "").toLowerCase().trim();
  const filtroEmail = (document.getElementById("filtro-email")?.value || "").toLowerCase().trim();

  // Filtra as avaliações
  const avaliacoesFiltradas = TODAS_AVALIACOES.filter((item) => {
    const codigo = (item.codigo_avaliacao || "").toLowerCase();
    const cliente = (item.cliente_nome || "").toLowerCase();
    const objeto = (item.objeto || "").toLowerCase();
    const local = (item.local || "").toLowerCase();
    const criadoPor = (item.criado_por_nome || "").trim();
    const status = (item.status || "").toLowerCase();
    const data = item.data_avaliacao || "";
    const solicitante = (item.solicitante_nome || "").toLowerCase();
    const email = (item.email_cliente || "").toLowerCase();

    const codigoMatch = !filtroCodigo || codigo.includes(filtroCodigo);
    const clienteMatch = !filtroCliente || cliente.includes(filtroCliente);
    const objetoMatch = !filtroObjeto || objeto.includes(filtroObjeto);
    const localMatch = !filtroLocal || local.includes(filtroLocal);
    const criadoPorMatch = !filtroCriadoPor || criadoPor === filtroCriadoPor;
    const statusMatch = !filtroStatus || status === filtroStatus;
    const dataMatch = !filtroData || data === filtroData;
    const solicitanteMatch = !filtroSolicitante || solicitante.includes(filtroSolicitante);
    const emailMatch = !filtroEmail || email.includes(filtroEmail);

    return codigoMatch && clienteMatch && objetoMatch && localMatch &&
           criadoPorMatch && statusMatch && dataMatch && solicitanteMatch && emailMatch;
  });

  // Renderiza as avaliações filtradas na tabela
  renderizarTabelaAvaliacoes(avaliacoesFiltradas);
}

// Renderiza a tabela de avaliações com os dados fornecidos
function renderizarTabelaAvaliacoes(lista) {

  if (!avaliacoesTbody) return;

  // Atualiza filtro 'Criado por' sempre que renderiza a lista completa
  if (Array.isArray(lista) && lista.length > 0 && lista === TODAS_AVALIACOES) {
    popularFiltroCriadoPor(lista);
  }

  if (!lista || lista.length === 0) {
    avaliacoesTbody.innerHTML = '<tr><td colspan="6" class="table-empty">Nenhuma avaliação encontrada.</td></tr>';
    return;
  }

  const linhas = lista.map((item) => {
    const dataStr = item.data_avaliacao || "";
    let dataFormatada = dataStr;
    if (dataStr && dataStr.includes("-")) {
      const [ano, mes, dia] = dataStr.split("-");
      dataFormatada = `${dia}/${mes}/${ano}`;
    }

    const cliente = item.cliente_nome || "";
    const local = item.local || "";
    const statusRaw = (item.status || "").toString().toLowerCase();
    const statusExibicao = formatarStatusExibicao(statusRaw);
    const objeto = item.objeto || "";
    const codigo = (item.codigo_avaliacao && item.codigo_avaliacao.toString()) ||
                   (item.id != null ? String(item.id) : "");

    // Flag "Nova" para avaliações com status ABERTO
    const isNova = statusRaw === "aberto";
    const badgeNova = isNova ? '<span class="badge-nova">NOVA</span>' : '';
    const classeNova = isNova ? 'avaliacao-nova' : '';

    const criadoPor = item.criado_por_nome || "-";
    return `
      <tr class="avaliacao-row ${classeNova}" data-avaliacao-id="${item.id}">
        <td>${codigo} ${badgeNova}</td>
        <td>${objeto}</td>
        <td>${cliente}</td>
        <td>${dataFormatada}</td>
        <td>${local}</td>
        <td>${statusExibicao}</td>
        <td>${criadoPor}</td>
      </tr>
    `;
  }).join("");

  avaliacoesTbody.innerHTML = linhas;
  
  // Registra listeners de clique nas linhas
  const linhasTabela = avaliacoesTbody.querySelectorAll("tr.avaliacao-row");
  linhasTabela.forEach((tr) => {
    const id = tr.getAttribute("data-avaliacao-id");
    if (!id) return;

    tr.addEventListener("click", async () => {
      if (salvarAvaliacaoButton) salvarAvaliacaoButton.disabled = true;
      if (novaAvaliacaoButton) novaAvaliacaoButton.disabled = true;
      if (recarregarButton) recarregarButton.disabled = true;

      const linhasTabelaInterno = avaliacoesTbody.querySelectorAll("tr.avaliacao-row");
      linhasTabelaInterno.forEach((linha) => {
        linha.classList.add("lista-avaliacoes-bloqueada");
      });

      try {
        await carregarAvaliacaoParaEdicao(parseInt(id, 10));
        atualizarVisibilidadeBotaoExportarPDF(); // Atualiza visibilidade do botão Exportar PDF após carregar avaliação
      } finally {
        if (salvarAvaliacaoButton) salvarAvaliacaoButton.disabled = false;
        if (novaAvaliacaoButton) novaAvaliacaoButton.disabled = false;
        if (recarregarButton) recarregarButton.disabled = false;

        linhasTabelaInterno.forEach((linha) => {
          linha.classList.remove("lista-avaliacoes-bloqueada");
        });
      }
    });
  });
}

// Inicializa os eventos dos filtros
function inicializarFiltrosAvaliacoes() {
  const btnFiltros = document.getElementById("btn-filtros-avaliacoes");
  const btnLimpar = document.getElementById("btn-limpar-filtros");
  const btnAplicar = document.getElementById("btn-aplicar-filtros");

  if (btnFiltros) {
    btnFiltros.addEventListener("click", toggleFiltrosAvaliacoes);
  }
  if (btnLimpar) {
    btnLimpar.addEventListener("click", limparFiltrosAvaliacoes);
  }
  if (btnAplicar) {
    btnAplicar.addEventListener("click", aplicarFiltrosAvaliacoes);
  }

  // Permite aplicar filtros ao pressionar Enter nos campos de texto
  const camposTexto = [
    "filtro-codigo", "filtro-cliente", "filtro-objeto",
    "filtro-local", "filtro-solicitante", "filtro-email"
  ];
  camposTexto.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("keypress", (e) => {
        if (e.key === "Enter") aplicarFiltrosAvaliacoes();
      });
    }
  });

  // Aplica filtros automaticamente ao mudar status ou data
  const filtroStatus = document.getElementById("filtro-status");
  const filtroData = document.getElementById("filtro-data");
  if (filtroStatus) {
    filtroStatus.addEventListener("change", aplicarFiltrosAvaliacoes);
  }
  if (filtroData) {
    filtroData.addEventListener("change", aplicarFiltrosAvaliacoes);
  }
}

// ================== FIM: FILTROS DE AVALIAÇÕES REGISTRADAS ==================

// Função auxiliar para tentar resumir o campo "detalhes" da auditoria
function resumirDetalhesAuditoria(detalhesBruto) { // declara função que recebe a string detalhes recebida da API
  if (!detalhesBruto) { // verifica se o valor é vazio, null ou undefined
    return ""; // se for vazio, retorna string vazia
  }

  try { // inicia bloco try para tentar interpretar a string como JSON
    const obj = JSON.parse(detalhesBruto); // tenta converter a string em objeto JavaScript usando JSON.parse

    // Se o JSON tiver uma chave "acao" e mais alguma chave, montamos um resumo simples
    if (obj.acao && typeof obj === "object") { // verifica se existe a propriedade "acao" e se é um objeto
      // Monta uma lista de pares chave: valor (ignorando "acao" porque já vai na frente)
      const partes = []; // cria array vazio para acumular partes de texto

      Object.keys(obj).forEach((chave) => { // percorre todas as chaves do objeto
        if (chave === "acao") { // se a chave for "acao"
          return; // não adiciona ao array de partes, porque já será usada no início
        }
        const valor = obj[chave]; // obtém o valor associado à chave atual
        if (valor !== null && valor !== undefined && valor !== "") { // garante que o valor não é vazio
          partes.push(`${chave}: ${valor}`); // adiciona ao array uma string no formato "chave: valor"
        }
      });

      const detalhesExtra = partes.join(" | "); // junta todas as partes com separador " | "
      if (detalhesExtra) { // se houver conteúdo extra além de "acao"
        return `${obj.acao} – ${detalhesExtra}`; // retorna string com a ação e os detalhes extras
      }
      return String(obj.acao); // se não houver detalhes extras, retorna apenas a ação em formato string
    }

    // Se não tiver chave "acao", mostramos o JSON inteiro compactado
    return JSON.stringify(obj); // converte o objeto JSON de volta para string em formato JSON
  } catch (e) { // se der erro no JSON.parse, cai aqui
    // Se não for JSON válido, devolve o texto original
    return detalhesBruto; // retorna a mesma string recebida, sem alterações
  }
}

// Arrays globais para armazenar todos os dados para filtros
let AUDIT_TODOS_USUARIOS = []; // array com todos os usuários para filtragem
let AUDIT_TODAS_AVALIACOES = []; // array com todas as avaliações para filtragem

// Carrega a lista de usuários apenas para preencher o select e o mapa interno
async function carregarUsuariosParaAuditoria() { // declara função assíncrona que busca usuários na API
  const select = document.getElementById("audit-user-select"); // obtém o elemento select de usuários pelo id

  if (!select) { // se o elemento não for encontrado no DOM
    console.warn("Elemento #audit-user-select não encontrado no DOM."); // exibe aviso no console para depuração
    return; // encerra a função sem fazer nada
  }

  select.innerHTML = '<option value="">Carregando usuários...</option>'; // define temporariamente uma opção informando que está carregando

  const resp = await fetch(API_BASE_URL + "/usuarios", { // chama a API GET /usuarios usando fetch
    method: "GET", // método HTTP GET
    headers: { // cabeçalhos HTTP da requisição
      "Content-Type": "application/json", // informa que esperamos JSON
      "Authorization": "Bearer " + authToken // adiciona header de autorização com o token JWT
    }
  });

  if (!resp.ok) { // verifica se a resposta não teve status 2xx
    console.error("Falha ao carregar usuários para auditoria:", resp.status); // mostra erro no console com o status HTTP
    select.innerHTML = '<option value="">Erro ao carregar usuários</option>'; // atualiza o select para informar erro ao usuário
    return; // encerra função
  }

  const usuarios = await resp.json(); // converte o corpo da resposta de JSON para objeto JavaScript

  AUDIT_MAPA_USUARIOS = {}; // limpa o mapa de usuários para garantir dados sincronizados
  AUDIT_TODOS_USUARIOS = usuarios; // armazena todos os usuários no array global

  usuarios.forEach((u) => { // percorre o array de usuários retornado pela API
    AUDIT_MAPA_USUARIOS[u.id] = u; // armazena o usuário no mapa, usando id como chave
  });

  aplicarFiltrosUsuarioAuditoria(); // aplica filtros (mostra todos inicialmente)
}

// Aplica filtros de nome e e-mail no select de usuários
function aplicarFiltrosUsuarioAuditoria() {
  const select = document.getElementById("audit-user-select"); // obtém o select
  const inputNome = document.getElementById("audit-user-nome"); // campo de filtro por nome
  const inputEmail = document.getElementById("audit-user-email"); // campo de filtro por e-mail

  if (!select) return; // sai se select não existir

  const filtroNome = (inputNome?.value || "").toLowerCase().trim(); // valor do filtro de nome em minúsculas
  const filtroEmail = (inputEmail?.value || "").toLowerCase().trim(); // valor do filtro de e-mail em minúsculas

  // Filtra os usuários conforme os critérios
  const usuariosFiltrados = AUDIT_TODOS_USUARIOS.filter((u) => {
    const nomeMatch = !filtroNome || // se não há filtro de nome, passa
      (u.nome && u.nome.toLowerCase().includes(filtroNome)) || // verifica nome
      (u.username && u.username.toLowerCase().includes(filtroNome)); // verifica username
    const emailMatch = !filtroEmail || // se não há filtro de e-mail, passa
      (u.email && u.email.toLowerCase().includes(filtroEmail)); // verifica e-mail
    return nomeMatch && emailMatch; // retorna true se ambos os filtros passam
  });

  select.innerHTML = '<option value="">-- Selecione um usuário --</option>'; // limpa e adiciona opção padrão

  usuariosFiltrados.forEach((u) => { // percorre usuários filtrados
    const opt = document.createElement("option"); // cria option
    opt.value = String(u.id); // define valor como id
    opt.textContent = `${u.nome || u.username} (${u.email || "sem e-mail"})`; // exibe nome e e-mail
    select.appendChild(opt); // adiciona ao select
  });

  // Atualiza texto informativo se não houver resultados
  if (usuariosFiltrados.length === 0 && (filtroNome || filtroEmail)) {
    select.innerHTML = '<option value="">Nenhum usuário encontrado</option>';
  }
}

// Carrega a lista de avaliações para o select e o mapa interno
async function carregarAvaliacoesParaAuditoria() { // declara função assíncrona responsável por buscar avaliações
  const select = document.getElementById("audit-avaliacao-select"); // pega o select de avaliações pelo id

  if (!select) { // se o elemento não existir
    console.warn("Elemento #audit-avaliacao-select não encontrado no DOM."); // mostra aviso no console
    return; // encerra função
  }

  select.innerHTML = '<option value="">Carregando avaliações...</option>'; // mostra mensagem de carregamento no select

  const resp = await fetch(API_BASE_URL + "/avaliacoes", { // chama a API GET /avaliacoes
    method: "GET", // método HTTP GET
    headers: { // cabeçalhos HTTP
      "Content-Type": "application/json", // especifica que esperamos JSON
      "Authorization": "Bearer " + authToken // envia o token JWT no cabeçalho Authorization
    }
  });

  if (!resp.ok) { // se status não for 2xx
    console.error("Falha ao carregar avaliações para auditoria:", resp.status); // loga erro com o status HTTP
    select.innerHTML = '<option value="">Erro ao carregar avaliações</option>'; // informa erro ao usuário no select
    return; // encerra a função
  }

  const avaliacoes = await resp.json(); // converte o corpo da resposta de JSON para array de objetos

  AUDIT_MAPA_AVALIACOES = {}; // reseta o mapa de avaliações
  AUDIT_TODAS_AVALIACOES = avaliacoes; // armazena todas as avaliações no array global

  avaliacoes.forEach((a) => { // percorre o array de avaliações
    AUDIT_MAPA_AVALIACOES[a.id] = a; // armazena cada avaliação no mapa usando id como chave
  });

  aplicarFiltrosAvaliacaoAuditoria(); // aplica filtros (mostra todos inicialmente)
}

// Aplica filtros de código, objeto, cliente e data no select de avaliações
function aplicarFiltrosAvaliacaoAuditoria() {
  const select = document.getElementById("audit-avaliacao-select"); // obtém o select
  const inputCodigo = document.getElementById("audit-avaliacao-codigo"); // campo de filtro por código
  const inputObjeto = document.getElementById("audit-avaliacao-objeto"); // campo de filtro por objeto
  const inputCliente = document.getElementById("audit-avaliacao-cliente"); // campo de filtro por cliente
  const inputData = document.getElementById("audit-avaliacao-data"); // campo de filtro por data

  if (!select) return; // sai se select não existir

  const filtroCodigo = (inputCodigo?.value || "").toLowerCase().trim(); // valor do filtro de código
  const filtroObjeto = (inputObjeto?.value || "").toLowerCase().trim(); // valor do filtro de objeto
  const filtroCliente = (inputCliente?.value || "").toLowerCase().trim(); // valor do filtro de cliente
  const filtroData = (inputData?.value || "").trim(); // valor do filtro de data (formato YYYY-MM-DD)

  // Filtra as avaliações conforme os critérios
  const avaliacoesFiltradas = AUDIT_TODAS_AVALIACOES.filter((a) => {
    const codigoMatch = !filtroCodigo || // se não há filtro de código, passa
      (a.codigo_avaliacao && a.codigo_avaliacao.toLowerCase().includes(filtroCodigo)); // verifica codigo_avaliacao
    const objetoMatch = !filtroObjeto || // se não há filtro de objeto, passa
      (a.objeto && a.objeto.toLowerCase().includes(filtroObjeto)); // verifica objeto
    const clienteMatch = !filtroCliente || // se não há filtro de cliente, passa
      (a.cliente_nome && a.cliente_nome.toLowerCase().includes(filtroCliente)); // verifica cliente
    const dataMatch = !filtroData || // se não há filtro de data, passa
      (a.data_avaliacao && a.data_avaliacao === filtroData); // verifica data exata
    return codigoMatch && objetoMatch && clienteMatch && dataMatch; // retorna true se todos os filtros passam
  });

  select.innerHTML = '<option value="">-- Selecione uma avaliação --</option>'; // limpa e adiciona opção padrão

  avaliacoesFiltradas.forEach((a) => { // percorre avaliações filtradas
    const opt = document.createElement("option"); // cria option
    opt.value = String(a.id); // define valor como id
    // Monta label com CÓDIGO - cliente
    const codigo = a.codigo_avaliacao || `AVT${a.id}`;
    const cliente = a.cliente_nome || "Sem cliente";
    opt.textContent = `${codigo} - ${cliente}`; // exibe apenas código e cliente
    select.appendChild(opt); // adiciona ao select
  });

  // Atualiza texto informativo se não houver resultados
  if (avaliacoesFiltradas.length === 0 && (filtroCodigo || filtroObjeto || filtroCliente || filtroData)) {
    select.innerHTML = '<option value="">Nenhuma avaliação encontrada</option>';
  }
}

// Busca e exibe a auditoria de um usuário específico
async function carregarAuditoriaUsuarioSelecionado() { // declara função assíncrona para carregar logs de um usuário
  const select = document.getElementById("audit-user-select"); // obtém o select de usuários
  const tbody = document.getElementById("audit-user-tbody"); // obtém o corpo da tabela de auditoria de usuários

  if (!select || !tbody) { // verifica se o select ou o tbody não existem no DOM
    console.warn("Elementos da tabela de auditoria de usuários não encontrados."); // loga aviso
    return; // encerra a função
  }

  const usuarioIdStr = select.value; // pega o valor selecionado (id do usuário em formato string)
  if (!usuarioIdStr) { // se nada foi selecionado (valor vazio)
    tbody.innerHTML = ""; // limpa a tabela
    return; // encerra a função (não busca nada)
  }

  const usuarioId = parseInt(usuarioIdStr, 10); // converte o valor para número inteiro

  tbody.innerHTML = "<tr><td colspan='5'>Carregando auditoria...</td></tr>"; // exibe linha temporária informando que está carregando

  const resp = await fetch(API_BASE_URL + `/usuarios/${usuarioId}/auditoria`, { // chama a API GET /usuarios/{id}/auditoria
    method: "GET", // método HTTP GET
    headers: { // cabeçalhos HTTP
      "Content-Type": "application/json", // esperamos JSON
      "Authorization": "Bearer " + authToken // envia o token JWT no cabeçalho Authorization
    }
  });

  if (!resp.ok) { // se resposta não for 2xx
    console.error("Erro ao buscar auditoria de usuário:", resp.status); // loga o erro com status HTTP
    tbody.innerHTML = "<tr><td colspan='5'>Erro ao carregar auditoria.</td></tr>"; // mostra mensagem de erro na tabela
    return; // encerra função
  }

  const logs = await resp.json(); // converte o corpo da resposta em array de registros de auditoria

  if (!logs.length) { // se não houver registros na auditoria
    tbody.innerHTML = "<tr><td colspan='5'>Nenhum registro de auditoria para este usuário.</td></tr>"; // mostra mensagem de vazio
    return; // encerra função
  }

  tbody.innerHTML = ""; // limpa qualquer conteúdo anterior da tabela

  logs.forEach((log) => { // percorre cada registro de auditoria
    const tr = document.createElement("tr"); // cria uma nova linha na tabela

    const tdData = document.createElement("td"); // cria célula para data/hora
    tdData.textContent = log.data_hora || ""; // preenche com campo data_hora retornado pela API ou string vazia
    tr.appendChild(tdData); // adiciona célula à linha

    const tdAcao = document.createElement("td"); // cria célula para ação
    tdAcao.textContent = log.acao || ""; // preenche com código da ação
    tr.appendChild(tdAcao); // adiciona célula à linha

    const tdUsuarioAlvo = document.createElement("td"); // cria célula para usuário alvo
    const alvo = AUDIT_MAPA_USUARIOS[log.usuario_alvo_id]; // tenta obter o objeto do usuário alvo a partir do mapa
    tdUsuarioAlvo.textContent = alvo // verifica se encontrou o objeto de usuário
      ? `${alvo.id} - ${alvo.username}` // se encontrou, mostra id e username
      : String(log.usuario_alvo_id); // se não encontrou, mostra apenas o id
    tr.appendChild(tdUsuarioAlvo); // adiciona célula à linha

    const tdUsuarioAcao = document.createElement("td"); // cria célula para usuário que executou a ação
    if (log.usuario_acao_id) { // se houver id do usuário responsável
      const usrAcao = AUDIT_MAPA_USUARIOS[log.usuario_acao_id]; // tenta buscar no mapa de usuários
      tdUsuarioAcao.textContent = usrAcao // se encontrou o objeto
        ? `${usrAcao.id} - ${usrAcao.username}` // mostra id e username do usuário que executou a ação
        : String(log.usuario_acao_id); // se não achou, mostra somente o id
    } else { // se usuario_acao_id for null (por exemplo, ações automáticas)
      tdUsuarioAcao.textContent = "Automático / Sistema"; // mostra texto padrão para ações sem usuário explícito
    }
    tr.appendChild(tdUsuarioAcao); // adiciona célula à linha

    const tdDetalhes = document.createElement("td"); // cria célula para detalhes
    tdDetalhes.textContent = resumirDetalhesAuditoria(log.detalhes); // chama helper para transformar detalhes em texto amigável
    tr.appendChild(tdDetalhes); // adiciona célula à linha

    tbody.appendChild(tr); // adiciona a linha completa ao corpo da tabela
  });
}

// Busca e exibe a auditoria de uma avaliação específica
async function carregarAuditoriaAvaliacaoSelecionada() { // declara função assíncrona que carrega logs da avaliação selecionada
  const select = document.getElementById("audit-avaliacao-select"); // obtém o select de avaliações
  const tbody = document.getElementById("audit-avaliacao-tbody"); // obtém o corpo da tabela de auditoria de avaliações

  if (!select || !tbody) { // verifica se algum dos elementos não foi encontrado
    console.warn("Elementos da tabela de auditoria de avaliações não encontrados."); // loga aviso no console
    return; // encerra a função
  }

  const avaliacaoIdStr = select.value; // pega o valor selecionado no select (id da avaliação como string)
  if (!avaliacaoIdStr) { // se nada foi selecionado
    tbody.innerHTML = ""; // limpa a tabela
    return; // encerra função
  }

  const avaliacaoId = parseInt(avaliacaoIdStr, 10); // converte string de id para número inteiro

  tbody.innerHTML = "<tr><td colspan='4'>Carregando auditoria...</td></tr>"; // mostra linha temporária informando que está carregando

  const resp = await fetch(API_BASE_URL + `/avaliacoes/${avaliacaoId}/auditoria`, { // chama a API GET /avaliacoes/{id}/auditoria
    method: "GET", // método HTTP GET
    headers: { // cabeçalhos da requisição
      "Content-Type": "application/json", // informa que estamos lidando com JSON
      "Authorization": "Bearer " + authToken // envia token JWT no cabeçalho Authorization
    }
  });

  if (!resp.ok) { // se a resposta não for 2xx
    console.error("Erro ao buscar auditoria de avaliação:", resp.status); // loga erro com o status HTTP
    tbody.innerHTML = "<tr><td colspan='4'>Erro ao carregar auditoria.</td></tr>"; // atualiza a tabela com mensagem de erro
    return; // encerra a função
  }

  const logs = await resp.json(); // converte o corpo da resposta em array de registros de auditoria

  if (!logs.length) { // se não houver registros de auditoria
    tbody.innerHTML = "<tr><td colspan='4'>Nenhum registro de auditoria para esta avaliação.</td></tr>"; // mostra mensagem de "vazio"
    return; // encerra função
  }

  tbody.innerHTML = ""; // limpa qualquer conteúdo anterior na tabela

  logs.forEach((log) => { // percorre cada registro de auditoria da avaliação
    const tr = document.createElement("tr"); // cria uma nova linha da tabela

    const tdData = document.createElement("td"); // célula para data/hora
    tdData.textContent = log.data_hora || ""; // preenche com campo data_hora retornado pela API
    tr.appendChild(tdData); // adiciona a célula à linha

    const tdAcao = document.createElement("td"); // célula para ação
    tdAcao.textContent = log.acao || ""; // preenche com código da ação (CRIAR, EDITAR, ADD_EQUIPAMENTO etc.)
    tr.appendChild(tdAcao); // adiciona célula à linha

    const tdUsuario = document.createElement("td"); // célula para usuário responsável
    tdUsuario.textContent = log.usuario || ""; // preenche com o campo usuario retornado (no backend está como "sistema" por enquanto)
    tr.appendChild(tdUsuario); // adiciona célula à linha

    const tdDetalhes = document.createElement("td"); // célula para detalhes
    tdDetalhes.textContent = resumirDetalhesAuditoria(log.detalhes); // converte detalhes em texto resumido usando helper
    tr.appendChild(tdDetalhes); // adiciona célula à linha

    tbody.appendChild(tr); // adiciona a linha montada ao corpo da tabela
  });
}

// Função para inicializar os eventos da tela de auditoria
function inicializarTelaAuditoria() { // declara função que liga os elementos de tela aos handlers
  const btnUser = document.getElementById("btn-load-user-audit"); // pega botão de carregar auditoria de usuários
  const btnAva = document.getElementById("btn-load-avaliacao-audit"); // pega botão de carregar auditoria de avaliações

  if (btnUser) { // se o botão de usuários existir
    btnUser.addEventListener("click", carregarAuditoriaUsuarioSelecionado); // adiciona listener de clique que chama a função de carregar logs de usuário
  }

  if (btnAva) { // se o botão de avaliações existir
    btnAva.addEventListener("click", carregarAuditoriaAvaliacaoSelecionada); // adiciona listener de clique que chama a função de carregar logs de avaliação
  }

  // === Filtros de Usuários ===
  const inputUserNome = document.getElementById("audit-user-nome"); // campo de filtro por nome
  const inputUserEmail = document.getElementById("audit-user-email"); // campo de filtro por e-mail

  if (inputUserNome) { // se o campo de nome existir
    inputUserNome.addEventListener("input", aplicarFiltrosUsuarioAuditoria); // aplica filtro ao digitar
  }
  if (inputUserEmail) { // se o campo de e-mail existir
    inputUserEmail.addEventListener("input", aplicarFiltrosUsuarioAuditoria); // aplica filtro ao digitar
  }

  // === Filtros de Avaliações ===
  const inputAvaCodigo = document.getElementById("audit-avaliacao-codigo"); // campo de filtro por código
  const inputAvaObjeto = document.getElementById("audit-avaliacao-objeto"); // campo de filtro por objeto
  const inputAvaCliente = document.getElementById("audit-avaliacao-cliente"); // campo de filtro por cliente
  const inputAvaData = document.getElementById("audit-avaliacao-data"); // campo de filtro por data

  if (inputAvaCodigo) { // se o campo de código existir
    inputAvaCodigo.addEventListener("input", aplicarFiltrosAvaliacaoAuditoria); // aplica filtro ao digitar
  }
  if (inputAvaObjeto) { // se o campo de objeto existir
    inputAvaObjeto.addEventListener("input", aplicarFiltrosAvaliacaoAuditoria); // aplica filtro ao digitar
  }
  if (inputAvaCliente) { // se o campo de cliente existir
    inputAvaCliente.addEventListener("input", aplicarFiltrosAvaliacaoAuditoria); // aplica filtro ao digitar
  }
  if (inputAvaData) { // se o campo de data existir
    inputAvaData.addEventListener("change", aplicarFiltrosAvaliacaoAuditoria); // aplica filtro ao alterar data
  }

  // Também é útil carregar as listas assim que a tela de auditoria for exibida.
  // Se você tiver uma função de navegação de abas, pode chamar estas duas funções quando abrir a aba Auditoria.
  carregarUsuariosParaAuditoria(); // dispara carregamento inicial da lista de usuários
  carregarAvaliacoesParaAuditoria(); // dispara carregamento inicial da lista de avaliações
}

// Chame `inicializarTelaAuditoria()` quando a aba de Auditoria for aberta
// Exemplo (ajuste para o seu sistema de navegação):
// - ao clicar no botão/menu "Auditoria", além de mostrar a section, chame esta função:
//   inicializarTelaAuditoria();

// ==================== PRÉ-VISUALIZAÇÃO DAS IMAGENS DE LOCALIZAÇÃO ====================

function abrirModalPreviewImagem(src, descricao) {                 // abre o modal global exibindo a imagem ampliada
  const modal = document.getElementById("image-preview-modal");    // obtém o elemento raiz do modal de preview
  if (!modal) {                                                    // se o modal não for encontrado no DOM
    console.warn("[IMAGENS] Modal de preview não encontrado no DOM."); // registra um aviso no console para facilitar debug
    return;                                                        // encerra a função sem tentar abrir nada
  }

  if (!src) {                                                      // se não foi passada uma URL de imagem válida
    alert("Nenhuma imagem disponível para ampliar.");              // exibe alerta informando que não há imagem
    return;                                                        // encerra a função sem abrir o modal
  }

  const img = modal.querySelector(".image-preview-img");           // busca o elemento <img> que exibirá a foto ampliada
  const caption = modal.querySelector(".image-preview-caption");   // busca o elemento que exibirá a legenda/descrição

  if (img) {                                                       // se o elemento de imagem foi encontrado
    img.src = src;                                                 // define o src da imagem com a URL recebida
  }
  if (caption) {                                                   // se o elemento de legenda foi encontrado
    caption.textContent = descricao || "";                         // preenche o texto da legenda (ou string vazia se não houver descrição)
  }

  modal.classList.add("open");                                     // adiciona a classe "open" para tornar o modal visível
}

function inicializarModalPreviewImagens() {                        // configura os eventos de fechamento do modal de imagem
  const modal = document.getElementById("image-preview-modal");    // obtém o elemento do modal de preview
  if (!modal) {                                                    // se o modal não existe no DOM
    return;                                                        // não há nada para configurar, então encerra a função
  }

  const closeBtn = modal.querySelector(".image-preview-close");    // obtém o botão de fechar (X) dentro do modal
  const backdrop = modal.querySelector(".image-preview-backdrop"); // obtém a camada de fundo escurecida do modal

  const fecharModal = () => {                                      // função auxiliar para esconder o modal
    modal.classList.remove("open");                                // remove a classe "open", escondendo o modal novamente
  };

  if (closeBtn) {                                                  // se o botão de fechar foi encontrado
    closeBtn.addEventListener("click", fecharModal);               // fecha o modal quando o usuário clicar no X
  }

  if (backdrop) {                                                  // se o fundo escurecido foi encontrado
    backdrop.addEventListener("click", fecharModal);               // fecha o modal quando o usuário clicar fora da caixa de conteúdo
  }

  document.addEventListener("keydown", (event) => {                // adiciona ouvinte global para eventos de teclado
    if (event.key === "Escape" && modal.classList.contains("open")) { // se a tecla pressionada for ESC e o modal estiver aberto
      fecharModal();                                               // fecha o modal ao pressionar ESC
    }
  });                                                              // fim do listener de teclado
}

function inicializarSecaoLocalizacaoImagens() {                      // inicializa a seção de localização / imagens

  // -------------------- LOCALIZAÇÃO: Blocos dinâmicos (igual Q2 Switch) --------------------

  const localizacaoBlocosContainer = document.getElementById("localizacao-imagens-rows"); // container dos blocos
  const localizacaoBlocosFileInput = document.getElementById("localizacao-imagens-file-input"); // input file (oculto) da seção
  const localizacaoBlocosBtnAdd = document.getElementById("btn-localizacao-adicionar-imagem"); // botão "Nova imagem"

  if (localizacaoBlocosContainer && localizacaoBlocosFileInput && localizacaoBlocosBtnAdd) { // só ativa se a UI nova existir
    let localizacaoLinhas = []; // estado das linhas (url + descrição)
    let localizacaoLinhaIdAlvo = null; // id da linha que acionou o input file

    function localizacaoGerarLinhaId() { // gera id simples para linha
      return "loc_" + Date.now().toString(36) + "_" + Math.random().toString(16).slice(2); // id pseudo-único
    }

    function localizacaoAplicarThumb(img, placeholder, src) { // atualiza miniatura/placeholder
      if (!src) { // sem src
        img.src = ""; // limpa imagem
        img.style.display = "none"; // esconde <img>
        placeholder.style.display = "block"; // mostra placeholder
        return; // encerra
      }
      img.src = src; // define src
      img.style.display = "block"; // mostra <img>
      placeholder.style.display = "none"; // esconde placeholder
      img.onerror = function () { // fallback se src inválido
        img.src = ""; // limpa
        img.style.display = "none"; // esconde
        placeholder.style.display = "block"; // mostra placeholder
      };
    }

    function localizacaoCriarLinhaDOM(linha) { // cria um bloco (image-row)
      const row = document.createElement("div"); // wrapper do bloco
      row.className = "image-row"; // usa layout mobile-friendly existente
      row.dataset.linhaId = linha.id; // id para localizar no estado

      const colThumb = document.createElement("div"); // coluna da miniatura
      colThumb.className = "image-thumb-column"; // classe padrão

      const wrapThumb = document.createElement("div"); // wrapper da miniatura
      wrapThumb.className = "image-thumb-wrapper"; // classe padrão

      const img = document.createElement("img"); // <img> miniatura
      img.className = "image-thumb"; // classe padrão
      img.alt = "Prévia da imagem de localização"; // acessibilidade
      img.id = `localizacao-${linha.id}-thumb`; // id da miniatura (usado no zoom)

      const ph = document.createElement("div"); // placeholder quando não há imagem
      ph.className = "image-thumb-placeholder"; // classe padrão
      ph.textContent = "Prévia não disponível"; // texto padrão

      wrapThumb.appendChild(img); // adiciona img no wrapper
      wrapThumb.appendChild(ph); // adiciona placeholder no wrapper
      colThumb.appendChild(wrapThumb); // adiciona wrapper na coluna

      // Clique na imagem para ampliar (substitui o botão Ampliar)
      img.style.cursor = "pointer"; // indica que é clicável
      img.title = "Clique para ampliar"; // tooltip informativo
      img.addEventListener("click", function () { // abre preview ao clicar na imagem
        if (!img.src) return; // sem imagem, ignora
        const descEl = document.getElementById(`localizacao-${linha.id}-descricao`); // pega descrição do bloco
        const descricao = descEl ? descEl.value : ""; // lê valor
        abrirModalPreviewImagem(img.src, descricao); // usa modal global existente
      });

      const colFields = document.createElement("div"); // coluna de campos
      colFields.className = "image-fields-column"; // classe padrão

      const groupDesc = document.createElement("div"); // grupo descrição
      groupDesc.className = "form-group full-width"; // padrão do form

      const labelDesc = document.createElement("label"); // label
      labelDesc.textContent = "Descrição / legenda"; // texto

      const inputDesc = document.createElement("input"); // input descrição
      inputDesc.type = "text"; // texto livre
      inputDesc.id = `localizacao-${linha.id}-descricao`; // id estável
      inputDesc.placeholder = "Ex.: Fachada, entrada principal, vista aérea..."; // dica
      inputDesc.value = linha.descricao || ""; // preenche do estado
      inputDesc.addEventListener("input", function () { // mantém estado atualizado
        linha.descricao = inputDesc.value; // grava no estado
      });

      groupDesc.appendChild(labelDesc); // adiciona label
      groupDesc.appendChild(inputDesc); // adiciona input

      const actions = document.createElement("div"); // linha de botões
      actions.className = "image-row-actions"; // classe padrão

      const btnSelect = document.createElement("button"); // selecionar imagem
      btnSelect.type = "button";
      btnSelect.className = "btn btn-primary btn-small";
      btnSelect.textContent = "Selecionar imagem";
      btnSelect.addEventListener("click", function () { // abre file picker
        localizacaoLinhaIdAlvo = linha.id; // marca linha alvo
        localizacaoBlocosFileInput.click(); // dispara input file
      });

      const btnCamera = document.createElement("button"); // abrir câmera
      btnCamera.type = "button";
      btnCamera.className = "btn btn-primary btn-small";
      btnCamera.textContent = "Abrir câmera";
      btnCamera.addEventListener("click", function () { // captura via getUserMedia
        cameraAbrirModal((dataUrl) => { // abre modal e recebe dataURL
          linha.url = dataUrl; // salva no estado
          localizacaoRender(); // re-renderiza
        });
      });

      const btnRemove = document.createElement("button"); // remover bloco
      btnRemove.type = "button";
      btnRemove.className = "btn btn-excluir btn-small"; // usa classe padronizada de exclusão
      btnRemove.innerHTML = "🗑️"; // ícone de lixeira
      btnRemove.title = "Remover esta imagem"; // tooltip para acessibilidade
      btnRemove.addEventListener("click", function (evt) { // remove ou limpa
        evt.preventDefault(); // evita comportamento padrão
        evt.stopPropagation(); // evita propagação do evento
        const linhaAtual = localizacaoLinhas.find((x) => x.id === linha.id); // busca a linha pelo id
        if (!linhaAtual) return; // se não encontrar, sai // Se a imagem já está no Storage (não é dataURL), marca para deleção
        if (linhaAtual.url && !linhaAtual.url.startsWith("data:")) { // verifica se é URL real
          localizacaoImagensParaDeletar.push(linhaAtual.url); // adiciona à lista de pendentes
        }

        if (localizacaoLinhas.length > 1) { // se houver mais de um bloco
          localizacaoLinhas = localizacaoLinhas.filter((x) => x.id !== linha.id); // remove do estado
        } else { // se for o único bloco
          linhaAtual.url = ""; // limpa url
          linhaAtual.descricao = ""; // limpa descrição
        }
        localizacaoRender(); // re-renderiza
      });

      actions.appendChild(btnSelect); // adiciona botão selecionar
      actions.appendChild(btnCamera); // adiciona botão câmera
      actions.appendChild(btnRemove); // adiciona botão remover

      const hiddenUrl = document.createElement("input"); // hidden por linha (estado no DOM)
      hiddenUrl.type = "hidden";
      hiddenUrl.value = linha.url || ""; // salva url/dataURL atual
      hiddenUrl.className = "localizacao-bloco-url-hidden"; // classe para debug/seleção

      colFields.appendChild(groupDesc); // adiciona grupo de descrição
      colFields.appendChild(actions); // adiciona ações
      colFields.appendChild(hiddenUrl); // adiciona hidden

      row.appendChild(colThumb); // adiciona coluna thumb
      row.appendChild(colFields); // adiciona coluna campos

      localizacaoAplicarThumb(img, ph, linha.url || ""); // aplica thumb inicial

      return row; // devolve DOM pronto
    }

    function localizacaoRender() { // renderiza todos os blocos
      localizacaoBlocosContainer.innerHTML = ""; // limpa container
      localizacaoLinhas.forEach((linha) => { // cria cada bloco
        localizacaoBlocosContainer.appendChild(localizacaoCriarLinhaDOM(linha)); // adiciona no DOM
      });
    }

    localizacaoBlocosFileInput.addEventListener("change", function () { // quando escolhe arquivo
      const arquivo = localizacaoBlocosFileInput.files && localizacaoBlocosFileInput.files[0] // pega arquivo
        ? localizacaoBlocosFileInput.files[0]
        : null;
      if (!arquivo || !localizacaoLinhaIdAlvo) { // valida alvo/arquivo
        localizacaoBlocosFileInput.value = ""; // limpa input
        return; // encerra
      }
      // Validação de tamanho máximo
      if (arquivo.size > MAX_FILE_SIZE_BYTES) {
        alert(`O arquivo selecionado excede o tamanho máximo permitido (${MAX_FILE_SIZE_MB} MB).\n\nPor favor, selecione uma imagem menor.`);
        localizacaoBlocosFileInput.value = "";
        return;
      }

      const linha = localizacaoLinhas.find((x) => x.id === localizacaoLinhaIdAlvo); // encontra linha no estado
      localizacaoLinhaIdAlvo = null; // limpa alvo
      localizacaoBlocosFileInput.value = ""; // permite re-selecionar a mesma foto

      if (!linha) return; // se não encontrou, sai

      const reader = new FileReader(); // lê arquivo como dataURL (preview)
      reader.onload = function () { // ao terminar
        linha.url = String(reader.result || ""); // salva dataURL no estado
        localizacaoRender(); // re-renderiza
      };
      reader.readAsDataURL(arquivo); // inicia leitura
    });

    localizacaoBlocosBtnAdd.addEventListener("click", function () { // adiciona novo bloco
      localizacaoLinhas.push({ id: localizacaoGerarLinhaId(), url: "", descricao: "" }); // adiciona linha vazia
      localizacaoRender(); // re-renderiza
    });

    function localizacaoResetFromEmpty() { // reseta para 1 bloco vazio
      localizacaoLinhas = [{ id: localizacaoGerarLinhaId(), url: "", descricao: "" }]; // recria estado
      localizacaoImagensParaDeletar = []; // limpa lista de pendentes
      localizacaoRender(); // renderiza
    }

    window.localizacaoImagens = window.localizacaoImagens || {}; // garante objeto global
    window.localizacaoImagens.resetFromEmpty = localizacaoResetFromEmpty; // expõe para limpar ao criar nova avaliação
    window.localizacaoImagens.getLinhas = function () { return localizacaoLinhas; }; // expõe leitura do estado (para salvar)
    window.localizacaoImagens.setLinhas = function (arr) { // expõe escrita do estado (para editar)
      localizacaoLinhas = Array.isArray(arr) ? arr : []; // valida array
      localizacaoRender(); // renderiza
    };

    localizacaoResetFromEmpty(); // boot inicial com 1 bloco vazio
  }

  const botoesSelecionarArquivo = document.querySelectorAll(
    ".image-select-file-btn"
  );                                                                // seleciona todos os botões "Selecionar imagem" da seção
  botoesSelecionarArquivo.forEach(function (botao, index) {         // percorre cada botão encontrado
    botao.addEventListener("click", function () {                   // adiciona listener de clique ao botão atual
      const indiceImagem =
        botao.dataset.imageIndex || String(index + 1);              // obtém o índice da imagem via data-image-index ou usa a posição do botão
      fileInput.dataset.targetIndex = indiceImagem;                 // grava no input oculto qual miniatura deve ser atualizada
      fileInput.click();                                            // dispara o clique no input para abrir a galeria do dispositivo
    });                                                             // fim do listener de clique de cada botão
  });                                                               // fim do forEach sobre os botões de seleção de arquivo

  // ==================== MODAL GLOBAL DE CÂMERA (GETUSERMEDIA) ====================

  const cameraModal = document.getElementById("camera-modal");                // obtém o contêiner raiz do modal de câmera
  const cameraBackdrop = document.getElementById("camera-modal-backdrop");    // obtém o backdrop (clique fora para fechar)
  const cameraVideo = document.getElementById("camera-video");                // obtém o <video> que exibirá o stream
  const cameraCanvas = document.getElementById("camera-canvas");              // obtém o <canvas> para capturar frame
  const cameraBtnCapturar = document.getElementById("camera-btn-capturar");   // obtém o botão "Capturar foto"
  const cameraBtnFechar = document.getElementById("camera-btn-fechar");       // obtém o botão "Fechar"

  let cameraStreamAtivo = null;                                               // guarda o stream ativo para encerramento
  let cameraOnCapture = null;                                                 // guarda callback do contexto atual (recebe dataURL)

  function cameraPararStream() {                                              // encerra o stream atual (libera a câmera)
    if (!cameraStreamAtivo) {                                                 // se não há stream ativo
      return;                                                                 // não há nada para parar
    }
    cameraStreamAtivo.getTracks().forEach((track) => {                        // percorre tracks do stream
      track.stop();                                                           // para cada track
    });
    cameraStreamAtivo = null;                                                 // limpa referência do stream
  }

  function cameraFecharModal() {                                              // fecha modal e limpa recursos
    if (cameraModal) {                                                        // se o modal existe
      cameraModal.classList.remove("open");                                   // esconde o modal
    }
    if (cameraVideo) {                                                        // se o vídeo existe
      cameraVideo.srcObject = null;                                           // desconecta o stream do <video>
    }
    cameraPararStream();                                                      // garante que o stream seja encerrado
    cameraOnCapture = null;                                                   // limpa callback para evitar uso indevido
  }

  async function cameraAbrirModal(onCapture) {                                 // abre modal e inicia getUserMedia
    if (
      !cameraModal ||                                                         // valida modal
      !cameraVideo ||                                                         // valida vídeo
      !cameraCanvas ||                                                        // valida canvas
      !cameraBtnCapturar ||                                                   // valida botão capturar
      !cameraBtnFechar                                                        // valida botão fechar
    ) {
      alert("Modal de câmera não encontrado no HTML.");                        // alerta se o modal não existir
      return;                                                                 // encerra para evitar erro
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {    // valida suporte do navegador
      alert("Seu navegador não suporta câmera embutida (getUserMedia).");      // informa limitação
      return;                                                                 // encerra
    }

    cameraFecharModal();                                                      // garante estado limpo antes de abrir novamente
    cameraOnCapture = typeof onCapture === "function" ? onCapture : null;     // registra callback do contexto

    try {                                                                     // tenta acessar a câmera
      const stream = await navigator.mediaDevices.getUserMedia({              // solicita stream do navegador
        video: { facingMode: { ideal: "environment" } },                      // tenta preferir câmera traseira
        audio: false                                                          // sem áudio
      });

      cameraStreamAtivo = stream;                                             // salva stream para fechar depois
      cameraVideo.srcObject = stream;                                         // conecta stream ao <video>
      cameraModal.classList.add("open");                                      // exibe o modal
      await cameraVideo.play();                                               // inicia o vídeo (quando permitido)
    } catch (err) {                                                           // falhas: permissão negada/sem câmera/etc.
      console.error("Falha ao abrir câmera:", err);                           // log para depuração
      alert("Não foi possível acessar a câmera. Verifique permissões/HTTPS."); // feedback ao usuário
      cameraFecharModal();                                                    // limpa estado
    }
  }

  if (cameraBtnFechar) {                                                      // se o botão de fechar existe
    cameraBtnFechar.addEventListener("click", cameraFecharModal);             // fecha ao clicar
  }

  if (cameraBackdrop) {                                                       // se o backdrop existe
    cameraBackdrop.addEventListener("click", cameraFecharModal);              // fecha ao clicar fora
  }

  document.addEventListener("keydown", (event) => {                            // escuta teclas globais
    if (event.key === "Escape") {                                             // se pressionar ESC
      cameraFecharModal();                                                    // fecha o modal
    }
  });

  if (cameraBtnCapturar) {                                                    // se o botão capturar existe
    cameraBtnCapturar.addEventListener("click", () => {                       // captura frame ao clicar
      if (!cameraVideo || !cameraCanvas) {                                    // valida elementos
        return;                                                               // encerra se algo faltar
      }

      const width = cameraVideo.videoWidth || 1280;                           // largura do vídeo (fallback)
      const height = cameraVideo.videoHeight || 720;                          // altura do vídeo (fallback)

      cameraCanvas.width = width;                                             // ajusta canvas para a largura do frame
      cameraCanvas.height = height;                                           // ajusta canvas para a altura do frame

      const ctx = cameraCanvas.getContext("2d");                              // pega contexto 2D
      if (!ctx) {                                                             // se não conseguiu obter contexto
        return;                                                               // encerra
      }

      ctx.drawImage(cameraVideo, 0, 0, width, height);                        // desenha frame atual no canvas
      const dataUrl = cameraCanvas.toDataURL("image/jpeg", 0.85);             // exporta dataURL JPEG (compressão moderada)

      if (cameraOnCapture) {                                                  // se houver callback do contexto
        cameraOnCapture(dataUrl);                                             // entrega a foto ao chamador
      }

      cameraFecharModal();                                                    // fecha o modal após capturar
    });
  }

  // -------------------- "Abrir câmera" (LOCALIZAÇÃO) --------------------

  const botoesAbrirCamera = document.querySelectorAll(
    ".image-open-camera-btn"
  );                                                                          // seleciona botões "Abrir câmera" (Localização)

  function aplicarPreviewLocalizacaoPorCamera(indiceImagem, dataUrl) {        // aplica captura na imagem de Localização (1/2)
    const index = String(indiceImagem || "").trim();                          // normaliza índice como string
    if (!index) {                                                             // se índice não vier válido
      return;                                                                 // encerra
    }

    const thumbImg = document.getElementById(`localizacao-imagem${index}-thumb`);         // pega <img> da miniatura
    const placeholder = document.getElementById(`localizacao-imagem${index}-placeholder`); // pega placeholder da miniatura
    const urlInput = document.getElementById(`localizacao-imagem${index}-url`);            // pega campo legado de URL

    if (!thumbImg || !placeholder) {                                          // valida elementos visuais
      return;                                                                 // encerra
    }

    thumbImg.src = dataUrl;                                                   // seta src com dataURL capturado
    thumbImg.style.display = "block";                                         // garante visibilidade da miniatura
    placeholder.style.display = "none";                                       // esconde placeholder

    if (urlInput) {                                                           // se existir campo legado
      urlInput.value = dataUrl;                                               // salva dataURL no legado (compatibilidade temporária)
    }
  }

  botoesAbrirCamera.forEach(function (botao) {                                // percorre botões de câmera da Localização
    botao.addEventListener("click", function () {                              // ao clicar em "Abrir câmera"
      const indice = botao.getAttribute("data-image-index");                   // lê índice (1/2) do HTML
      cameraAbrirModal((dataUrl) => {                                          // abre modal e recebe a captura
        aplicarPreviewLocalizacaoPorCamera(indice, dataUrl);                   // aplica a captura na linha correta
      });
    });
  });

  // -------------------- Q2 SWITCH: Selecionar imagem + Abrir câmera (por linha) --------------------

  const q2SwitchFotosTbody = document.getElementById("q2-switch-fotos-tbody"); // tbody da tabela de fotos do switch
  const q2SwitchAdicionarFotoBtn = document.getElementById("btn-q2-switch-adicionar-foto"); // botão "Adicionar foto"
  const q2SwitchCampoLegadoPrincipal = document.getElementById("q2-switch-foto-url"); // hidden legado principal do switch

  const q2SwitchFileInput = document.createElement("input");                  // cria input file reaproveitável do Q2
  q2SwitchFileInput.type = "file";                                            // define tipo arquivo
  q2SwitchFileInput.accept = "image/*";                                       // aceita apenas imagens
  q2SwitchFileInput.style.display = "none";                                   // mantém oculto
  q2SwitchFileInput.id = "q2-switch-file-input-compartilhado";                // id para depuração

  document.body.appendChild(q2SwitchFileInput);                               // adiciona no DOM

  function q2SwitchSincronizarCampoLegadoPrincipal() {                        // mantém compatibilidade (um campo legado)
    if (!q2SwitchCampoLegadoPrincipal || !q2SwitchFotosTbody) {               // valida dependências
      return;                                                                 // encerra
    }

    const linhas = Array.from(
      q2SwitchFotosTbody.querySelectorAll(".q2-switch-fotos-linha")
    );                                                                        // lista linhas atuais

    const primeiraUrl = linhas
      .map((linha) => linha.querySelector(".q2-switch-foto-url-input"))        // pega hidden url por linha
      .map((input) => (input ? (input.value || "").trim() : ""))              // normaliza valores
      .find((valor) => !!valor) || "";                                        // pega a primeira não vazia (ou vazio)

    q2SwitchCampoLegadoPrincipal.value = primeiraUrl;                         // grava no campo legado principal
  }

  function q2SwitchAplicarPreviewNaLinha(linha, dataUrl) {                    // aplica foto + hidden na linha do Q2
    if (!linha) {                                                             // valida linha
      return;                                                                 // encerra
    }

    const img = linha.querySelector(".q2-switch-foto-preview");               // pega <img> da linha
    const placeholder = linha.querySelector(".q2-switch-foto-placeholder");   // pega placeholder da linha
    const urlInput = linha.querySelector(".q2-switch-foto-url-input");        // pega hidden url da linha

    if (img) {                                                                // se houver imagem
      img.src = dataUrl || "";                                                // define src (ou limpa)
      img.style.display = dataUrl ? "block" : "none";                         // mostra quando há foto
    }

    if (placeholder) {                                                        // se houver placeholder
      placeholder.style.display = dataUrl ? "none" : "inline";                // alterna conforme há foto
    }

    if (urlInput) {                                                           // se houver hidden
      urlInput.value = dataUrl || "";                                         // salva dataURL (temporário) no hidden
    }

    q2SwitchSincronizarCampoLegadoPrincipal();                                // atualiza campo legado principal
  }

  q2SwitchFileInput.addEventListener("change", function () {                  // ao escolher arquivo do Q2
    const arquivo =
      q2SwitchFileInput.files && q2SwitchFileInput.files[0]
        ? q2SwitchFileInput.files[0]
        : null;                                                               // pega arquivo selecionado

    const linhaAlvo = q2SwitchFileInput._targetRow || null;                   // recupera linha alvo marcada
    q2SwitchFileInput._targetRow = null;                                      // limpa referência da linha alvo

    if (!arquivo || !linhaAlvo) {                                             // valida arquivo e linha
      q2SwitchFileInput.value = "";                                           // limpa para permitir re-seleção
      return;                                                                 // encerra
    } // Validação de tamanho máximo
    if (arquivo.size > MAX_FILE_SIZE_BYTES) {
      alert(`O arquivo selecionado excede o tamanho máximo permitido (${MAX_FILE_SIZE_MB} MB).\n\nPor favor, selecione uma imagem menor.`);
      q2SwitchFileInput.value = "";
      return;
    }

    const reader = new FileReader();                                          // cria leitor para dataURL
    reader.onload = function () {                                             // quando terminar de ler
      const dataUrl = typeof reader.result === "string" ? reader.result : ""; // garante string
      q2SwitchAplicarPreviewNaLinha(linhaAlvo, dataUrl);                      // aplica preview + hidden
      q2SwitchFileInput.value = "";                                           // limpa para re-selecionar a mesma foto
    };

    reader.readAsDataURL(arquivo);                                            // inicia leitura
  });

  if (q2SwitchFotosTbody) {                                                   // só registra eventos se a tabela existir
    q2SwitchFotosTbody.addEventListener("click", function (event) {           // delegation no tbody
      const linha = event.target.closest(".q2-switch-fotos-linha");           // identifica a linha
      if (!linha) {                                                          // se não clicou numa linha
        return;                                                               // encerra
      }

      const btnSelecionar = event.target.closest(".q2-switch-foto-selecionar-btn"); // botão selecionar
      const btnCamera = event.target.closest(".q2-switch-foto-abrir-camera-btn");  // botão câmera
      const previewContainer = event.target.closest(".q2-switch-foto-preview-container"); // clique no preview
      const btnRemover = event.target.closest(".q2-switch-foto-remover");     // botão remover (lixeira)

      if (btnRemover) {                                                      // se clicou remover
        const todas = q2SwitchFotosTbody.querySelectorAll(".q2-switch-fotos-linha"); // conta linhas
        if (todas.length > 1) {                                              // se houver mais de uma
          linha.remove();                                                    // remove linha
        } else {                                                             // se for a única, apenas limpa
          const desc = linha.querySelector(".q2-switch-foto-descricao-input"); // pega descrição
          if (desc) { desc.value = ""; }                                     // limpa descrição
          q2SwitchAplicarPreviewNaLinha(linha, "");                           // limpa foto/hidden/placeholder
        }
        q2SwitchSincronizarCampoLegadoPrincipal();                            // re-sincroniza legado
        return;                                                              // encerra
      }

      if (btnCamera) {                                                       // se clicou em "Abrir câmera"
        cameraAbrirModal((dataUrl) => {                                       // abre modal e recebe captura
          q2SwitchAplicarPreviewNaLinha(linha, dataUrl);                      // aplica captura na linha
        });
        return;                                                              // encerra
      }

      if (btnSelecionar || previewContainer) {                                // selecionar ou clicar no preview
        q2SwitchFileInput._targetRow = linha;                                 // marca linha alvo
        q2SwitchFileInput.click();                                            // abre seletor de arquivo
        return;                                                              // encerra
      }
    });
  }

  if (q2SwitchAdicionarFotoBtn && q2SwitchFotosTbody) {                       // se botão/tabela existem
    q2SwitchAdicionarFotoBtn.addEventListener("click", function () {          // ao clicar em "Adicionar foto"
      const modelo = q2SwitchFotosTbody.querySelector(".q2-switch-fotos-linha"); // usa primeira linha como modelo
      if (!modelo) {                                                         // valida modelo
        return;                                                              // encerra
      }

      const novaLinha = modelo.cloneNode(true);                               // clona a linha
      const desc = novaLinha.querySelector(".q2-switch-foto-descricao-input"); // pega descrição
      if (desc) { desc.value = ""; }                                         // limpa descrição
      q2SwitchAplicarPreviewNaLinha(novaLinha, "");                            // limpa foto/hidden/placeholder
      q2SwitchFotosTbody.appendChild(novaLinha);                               // adiciona ao final
    });
  }

    // -------------------- Q2 SWITCH: Fotos em blocos (igual Localização / Imagens) --------------------

  const q2SwitchBlocosContainer = document.getElementById("q2-switch-imagens-rows"); // container dos blocos
  const q2SwitchBlocosFileInput = document.getElementById("q2-switch-imagens-file-input"); // input file (oculto) da seção
  const q2SwitchBlocosBtnAdd = document.getElementById("btn-q2-switch-adicionar-imagem"); // botão "Nova imagem"
  const q2SwitchLegadoUrlHidden = document.getElementById("q2-switch-foto-url");            // [LEGADO] campo principal (compatibilidade)

  if (q2SwitchBlocosContainer && q2SwitchBlocosFileInput && q2SwitchBlocosBtnAdd) { // só ativa se a UI nova existir
    let q2SwitchLinhas = []; // estado das linhas (url + descrição)
    let q2SwitchLinhaIdAlvo = null; // id da linha que acionou o input file

    function q2SwitchGerarLinhaId() { // gera id simples para linha
      return "q2sw_" + Date.now().toString(36) + "_" + Math.random().toString(16).slice(2); // id pseudo-único
    }

    function q2SwitchAplicarThumb(img, placeholder, src) { // atualiza miniatura/placeholder
      if (!src) { // sem src
        img.src = ""; // limpa imagem
        img.style.display = "none"; // esconde <img>
        placeholder.style.display = "block"; // mostra placeholder
        return; // encerra
      }
      img.src = src; // define src
      img.style.display = "block"; // mostra <img>
      placeholder.style.display = "none"; // esconde placeholder
      img.onerror = function () { // fallback se src inválido
        img.src = ""; // limpa
        img.style.display = "none"; // esconde
        placeholder.style.display = "block"; // mostra placeholder
      };
    }

    function q2SwitchSincronizarLegadoPrincipal() { // mantém compatibilidade com 1 URL
      if (!q2SwitchLegadoUrlHidden) return; // se não existir, sai
      const primeira = q2SwitchLinhas.find((x) => (x.url || "").trim() !== ""); // pega a primeira linha preenchida
      q2SwitchLegadoUrlHidden.value = primeira ? (primeira.url || "") : ""; // grava no hidden legado
    }

    function q2SwitchCriarLinhaDOM(linha) { // cria um bloco (image-row)
      const row = document.createElement("div"); // wrapper do bloco
      row.className = "image-row"; // usa layout mobile-friendly existente
      row.dataset.linhaId = linha.id; // id para localizar no estado

      const colThumb = document.createElement("div"); // coluna da miniatura
      colThumb.className = "image-thumb-column"; // classe padrão

      const wrapThumb = document.createElement("div"); // wrapper da miniatura
      wrapThumb.className = "image-thumb-wrapper"; // classe padrão

      const img = document.createElement("img"); // <img> miniatura
      img.className = "image-thumb"; // classe padrão
      img.alt = "Prévia da foto do switch"; // acessibilidade
      img.id = `q2-switch-${linha.id}-thumb`; // id da miniatura (usado no zoom)

      const ph = document.createElement("div"); // placeholder quando não há imagem
      ph.className = "image-thumb-placeholder"; // classe padrão
      ph.textContent = "Prévia não disponível"; // texto padrão

      wrapThumb.appendChild(img); // adiciona img no wrapper
      wrapThumb.appendChild(ph); // adiciona placeholder no wrapper
      colThumb.appendChild(wrapThumb); // adiciona wrapper na coluna

      // Clique na imagem para ampliar (substitui o botão Ampliar)
      img.style.cursor = "pointer"; // indica que é clicável
      img.title = "Clique para ampliar"; // tooltip informativo
      img.addEventListener("click", function () { // abre preview ao clicar na imagem
        if (!img.src) return; // sem imagem, ignora
        const descEl = document.getElementById(`q2-switch-${linha.id}-descricao`); // pega descrição do bloco
        const descricao = descEl ? descEl.value : ""; // lê valor
        abrirModalPreviewImagem(img.src, descricao); // usa modal global existente
      });

      const colFields = document.createElement("div"); // coluna de campos
      colFields.className = "image-fields-column"; // classe padrão

      const groupDesc = document.createElement("div"); // grupo descrição
      groupDesc.className = "form-group full-width"; // padrão do form

      const labelDesc = document.createElement("label"); // label
      labelDesc.textContent = "Descrição / legenda"; // texto

      const inputDesc = document.createElement("input"); // input descrição
      inputDesc.type = "text"; // texto livre
      inputDesc.id = `q2-switch-${linha.id}-descricao`; // id estável
      inputDesc.placeholder = "Ex.: Vista frontal, etiqueta, portas, uplinks..."; // dica
      inputDesc.value = linha.descricao || ""; // preenche do estado
      inputDesc.addEventListener("input", function () { // mantém estado atualizado
        linha.descricao = inputDesc.value; // grava no estado
      });

      groupDesc.appendChild(labelDesc); // adiciona label
      groupDesc.appendChild(inputDesc); // adiciona input

      const actions = document.createElement("div"); // linha de botões
      actions.className = "image-row-actions"; // classe padrão

      const btnSelect = document.createElement("button"); // selecionar imagem
      btnSelect.type = "button";
      btnSelect.className = "btn btn-primary btn-small";
      btnSelect.textContent = "Selecionar imagem";
      btnSelect.addEventListener("click", function () { // abre file picker
        q2SwitchLinhaIdAlvo = linha.id; // marca linha alvo
        q2SwitchBlocosFileInput.click(); // dispara input file
      });

      const btnCamera = document.createElement("button"); // abrir câmera
      btnCamera.type = "button";
      btnCamera.className = "btn btn-primary btn-small";
      btnCamera.textContent = "Abrir câmera";
      btnCamera.addEventListener("click", function () { // captura via getUserMedia
        cameraAbrirModal((dataUrl) => { // abre modal e recebe dataURL
          linha.url = dataUrl; // salva no estado
          q2SwitchRender(); // re-renderiza
        });
      });

      const btnRemove = document.createElement("button"); // remover bloco
      btnRemove.type = "button";
      btnRemove.className = "btn btn-excluir btn-small"; // usa classe padronizada de exclusão
      btnRemove.innerHTML = "🗑️"; // ícone de lixeira
      btnRemove.title = "Remover esta imagem"; // tooltip
      btnRemove.addEventListener("click", function (evt) { // remove ou limpa
        evt.preventDefault(); // evita comportamento padrão
        evt.stopPropagation(); // evita propagação
        const linhaAtual = q2SwitchLinhas.find((x) => x.id === linha.id); // busca linha
        if (!linhaAtual) return; // se não encontrar, sai // Se a imagem já está no Storage, marca para deleção
        if (linhaAtual.url && !linhaAtual.url.startsWith("data:")) { // verifica se é URL real
          q2SwitchImagensParaDeletar.push(linhaAtual.url); // adiciona à lista
        }

        if (q2SwitchLinhas.length > 1) { // se houver mais de um bloco
          q2SwitchLinhas = q2SwitchLinhas.filter((x) => x.id !== linha.id); // remove do estado
        } else { // se for o único bloco
          linhaAtual.url = ""; // limpa url
          linhaAtual.descricao = ""; // limpa descrição
        }
        q2SwitchRender(); // re-renderiza
      });

      actions.appendChild(btnSelect); // adiciona botão selecionar
      actions.appendChild(btnCamera); // adiciona botão câmera
      actions.appendChild(btnRemove); // adiciona botão remover

      const hiddenUrl = document.createElement("input"); // hidden por linha (estado no DOM)
      hiddenUrl.type = "hidden";
      hiddenUrl.value = linha.url || ""; // salva url/dataURL atual
      hiddenUrl.className = "q2-switch-bloco-url-hidden"; // classe para debug/seleção

      colFields.appendChild(groupDesc); // adiciona grupo de descrição
      colFields.appendChild(actions); // adiciona ações
      colFields.appendChild(hiddenUrl); // adiciona hidden

      row.appendChild(colThumb); // adiciona coluna thumb
      row.appendChild(colFields); // adiciona coluna campos

      q2SwitchAplicarThumb(img, ph, linha.url || ""); // aplica thumb inicial

      return row; // devolve DOM pronto
    }

    function q2SwitchSeedFromLegado() { // cria estado inicial a partir do legado
      const legado = q2SwitchLegadoUrlHidden ? (q2SwitchLegadoUrlHidden.value || "").trim() : ""; // lê hidden legado
      if (legado) { // se houver URL antiga
        return [{ id: q2SwitchGerarLinhaId(), url: legado, descricao: "" }]; // cria 1 bloco preenchido
      }
      return [{ id: q2SwitchGerarLinhaId(), url: "", descricao: "" }]; // 1 bloco vazio por padrão
    }

    function q2SwitchRender() { // renderiza todos os blocos
      q2SwitchBlocosContainer.innerHTML = ""; // limpa container
      q2SwitchLinhas.forEach((linha) => { // cria cada bloco
        q2SwitchBlocosContainer.appendChild(q2SwitchCriarLinhaDOM(linha)); // adiciona no DOM
      });
      q2SwitchSincronizarLegadoPrincipal(); // atualiza hidden legado com a 1ª foto
    }

    q2SwitchBlocosFileInput.addEventListener("change", function () { // quando escolhe arquivo
      const arquivo = q2SwitchBlocosFileInput.files && q2SwitchBlocosFileInput.files[0] // pega arquivo
        ? q2SwitchBlocosFileInput.files[0]
        : null;
      if (!arquivo || !q2SwitchLinhaIdAlvo) { // valida alvo/arquivo
        q2SwitchBlocosFileInput.value = ""; // limpa input
        return; // encerra
      }
      // Validação de tamanho máximo
      if (arquivo.size > MAX_FILE_SIZE_BYTES) {
        alert(`O arquivo selecionado excede o tamanho máximo permitido (${MAX_FILE_SIZE_MB} MB).\n\nPor favor, selecione uma imagem menor.`);
        q2SwitchBlocosFileInput.value = "";
        return;
      }

      const linha = q2SwitchLinhas.find((x) => x.id === q2SwitchLinhaIdAlvo); // encontra linha no estado
      q2SwitchLinhaIdAlvo = null; // limpa alvo
      q2SwitchBlocosFileInput.value = ""; // permite re-selecionar a mesma foto

      if (!linha) return; // se não encontrou, sai

      const reader = new FileReader(); // lê arquivo como dataURL (preview)
      reader.onload = function () { // ao terminar
        linha.url = String(reader.result || ""); // salva dataURL no estado
        q2SwitchRender(); // re-renderiza
      };
      reader.readAsDataURL(arquivo); // inicia leitura
    });

    q2SwitchBlocosBtnAdd.addEventListener("click", function () { // adiciona novo bloco
      q2SwitchLinhas.push({ id: q2SwitchGerarLinhaId(), url: "", descricao: "" }); // adiciona linha vazia
      q2SwitchRender(); // re-renderiza
    });

    function q2SwitchResetFromLegacy() { // reseta blocos lendo o hidden legado
      q2SwitchLinhas = q2SwitchSeedFromLegado(); // recria estado
      q2SwitchRender(); // renderiza
    }

    function q2SwitchResetFromEmpty() { // reseta para 1 bloco vazio
      q2SwitchLinhas = [{ id: q2SwitchGerarLinhaId(), url: "", descricao: "" }]; // recria estado
      q2SwitchImagensParaDeletar = []; // limpa lista de pendentes
      q2SwitchRender(); // renderiza
    }

    window.q2SwitchImagens = window.q2SwitchImagens || {}; // garante objeto global
    window.q2SwitchImagens.resetFromLegacy = q2SwitchResetFromLegacy; // expõe para recarregar ao editar
    window.q2SwitchImagens.resetFromEmpty = q2SwitchResetFromEmpty; // expõe para limpar ao criar nova
    window.q2SwitchImagens.getLinhas = function () { return q2SwitchLinhas; }; // expõe leitura do estado
    window.q2SwitchImagens.setLinhas = function (arr) { // expõe escrita do estado
      q2SwitchLinhas = Array.isArray(arr) ? arr : []; // valida array
      q2SwitchImagensParaDeletar = []; // limpa pendentes ao carregar
      q2SwitchRender(); // renderiza
    };

    q2SwitchResetFromLegacy(); // boot inicial
  }

}                                                                   // fim da função inicializarSecaoLocalizacaoImagens



// }

// Inicialização dos recursos de imagem quando o DOM estiver pronto
document.addEventListener("DOMContentLoaded", () => {             // aguarda o carregamento completo da estrutura HTML
  inicializarModalPreviewImagens();                               // configura os handlers de abrir/fechar do modal de imagem
  inicializarSecaoLocalizacaoImagens();                           // ativa a lógica de thumbnails e botões da seção de localização

  // ============ Event listener para dropdown de tipo de formulário ============
  if (tipoFormularioSelect) {
    tipoFormularioSelect.addEventListener("change", (e) => {
      const tipo = e.target.value || "utp_fibra";
      aplicarVisibilidadeTipoFormulario(tipo);
    });
  }

  // ============ Inicialização do tipo de formulário padrão ============
  if (tipoFormularioSelect && !tipoFormularioSelect.value) {
    tipoFormularioSelect.value = "utp_fibra";
  }

  if (tipoFormularioInput && !tipoFormularioInput.value) {
    tipoFormularioInput.value = "utp_fibra";
  }

  // Aplica visibilidade inicial
  const tipoInicial = tipoFormularioSelect?.value || tipoFormularioInput?.value || "utp_fibra";
  aplicarVisibilidadeTipoFormulario(tipoInicial);
});                                                                // fim do ouvinte de DOMContentLoaded