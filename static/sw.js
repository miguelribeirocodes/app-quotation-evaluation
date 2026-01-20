// ===================== Service Worker - Technical Quotation Evaluation =====================
// Este arquivo gerencia o cache dos assets para funcionamento offline.
// Estratégia: Cache First para assets, Network First para páginas
// =====================================================================

const CACHE_NAME = "evaluation_avaliacoes-v4"; // versão do cache (incrementar ao atualizar)

// Lista de arquivos essenciais para cache (app funcionar offline)
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/static/app.js",
  "/static/styles.css",
  "/static/manifest.webmanifest",
  "/static/icons/evaluation_icon-32.png",
  "/static/icons/evaluation_icon-180.png",
  "/static/icons/evaluation_icon-192.png",
  "/static/icons/evaluation_icon-512.png",
  "/static/icons/evaluation_icon.png"
];

// CDNs externos que devem ser cacheados
const EXTERNAL_URLS_TO_CACHE = [
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"
];

// --------------------------
// Evento: install
// --------------------------
// Quando o Service Worker é instalado pela primeira vez,
// faz o download e cache de todos os assets essenciais.
// Usa abordagem resiliente: cacheia o que conseguir, ignora falhas individuais.
self.addEventListener("install", function (event) {
  console.log("[SW] Instalando Service Worker...");
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      console.log("[SW] Fazendo cache dos assets essenciais");
      
      // Cacheia assets locais
      const localPromises = ASSETS_TO_CACHE.map(function (url) {
        return cache.add(url).then(function () {
          console.log("[SW] Cacheado:", url);
        }).catch(function (error) {
          console.warn("[SW] Falha ao cachear:", url, error.message);
        });
      });

      // Cacheia CDNs externos (com modo no-cors para evitar bloqueios CORS)
      const externalPromises = EXTERNAL_URLS_TO_CACHE.map(function (url) {
        return fetch(url, { mode: "cors" })
          .then(function (response) {
            if (response.ok) {
              return cache.put(url, response);
            }
          })
          .then(function () {
            console.log("[SW] Cacheado externo:", url);
          })
          .catch(function (error) {
            console.warn("[SW] Falha ao cachear externo:", url, error.message);
          });
      });

      return Promise.all([...localPromises, ...externalPromises]);
    }).then(function () {
      console.log("[SW] Instalação concluída");
      // Força ativação imediata (não espera abas fecharem)
      return self.skipWaiting();
    })
  );
});

// --------------------------
// Evento: activate
// --------------------------
// Quando o Service Worker é ativado, limpa caches antigos.
self.addEventListener("activate", function (event) {
  console.log("[SW] Ativando Service Worker...");
  event.waitUntil(
    caches.keys().then(function (cacheNames) {
      return Promise.all(
        cacheNames.map(function (cacheName) {
          // Remove caches antigos (versões anteriores)
          if (cacheName !== CACHE_NAME) {
            console.log("[SW] Removendo cache antigo:", cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(function () {
      // Toma controle de todas as páginas imediatamente
      return self.clients.claim();
    })
  );
});

// --------------------------
// Evento: fetch
// --------------------------
// Intercepta todas as requisições de rede.
// Estratégia: 
// - Para assets estáticos e CDNs: Cache First, Network fallback
// - Para páginas HTML: Network First, Cache fallback
self.addEventListener("fetch", function (event) {
  const request = event.request;
  const url = new URL(request.url);

  // Ignora requisições que não são GET (POST, PUT, DELETE, etc.)
  if (request.method !== "GET") {
    return;
  }

  // Ignora requisições para APIs dinâmicas (exceto Storage do Supabase)
  if (request.url.includes("/avaliacoes") || 
      request.url.includes("/usuarios") || 
      request.url.includes("/login") ||
      request.url.includes("/trocar-senha")) {
    return;
  }

  // Ignora requisições para o Storage do Supabase (upload/download de imagens)
  if (request.url.includes("supabase.co/storage")) {
    return;
  }

  // CDNs externos: Cache First (já cacheados durante install)
  if (url.hostname.includes("cdn.jsdelivr.net")) {
    event.respondWith(
      caches.match(request).then(function (cachedResponse) {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then(function (networkResponse) {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // Para navegação (páginas HTML): Network First
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(function (networkResponse) {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(function () {
          console.log("[SW] Offline - servindo página do cache");
          return caches.match("/index.html").then(function (cachedResponse) {
            return cachedResponse || caches.match("/");
          });
        })
    );
    return;
  }

  // Para outros assets (JS, CSS, imagens): Cache First
  event.respondWith(
    caches.match(request).then(function (cachedResponse) {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(request)
        .then(function (networkResponse) {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(function () {
          console.log("[SW] Recurso não encontrado no cache:", request.url);
          return new Response("Offline - recurso não disponível", {
            status: 503,
            statusText: "Service Unavailable"
          });
        });
    })
  );
});