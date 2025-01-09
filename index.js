const puppeteer = require('puppeteer');
const sanitizeHtml = require('sanitize-html');
const { createObjectCsvWriter } = require('csv-writer');
const readline = require('readline');

const consoleSuccess = (message) => {
    console.log('\x1b[32m%s\x1b[0m', message);
}

const consoleInfo = (message) => {
    console.log('\x1b[36m%s\x1b[0m', message); // Codice ANSI per il colore cyan
};

// Funzione per raccogliere input in un oggetto
const collectUserInputs = async () => {
    console.log('>> Inserisci le credenziali di login per "Corriere della Sera".');
    const cdsEmail = await askQuestion('>> Email: ');
    const cdsPassword = await askHiddenInput('>> Password: ');
    console.log('>> Inserisci le credenziali di login per "La Repubblica".');
    const repubblicaEmail = await askQuestion('>> Email: ');
    const repubblicaPassword = await askHiddenInput('>> Password: ');
    console.log('>> Inserisci la query di ricerca (se più di una separate da ,)');
    const query = (await askQuestion('>> Query di Ricerca: ')).toLowerCase();
    console.log('>> Inserisci i range di date per le query di ricerca in formato AAAA-MM-GG/AAAA-MM-GG (se più di una separate da ,)');
    const dateRanges = await askQuestion('>> Range di date: ');
    console.log('>> Inserisci il numero di pagine di risulati di "Libero" per le query di ricerca (se più di una separate da ,)');
    const liberoPageNumbers = await askQuestion('>> Numero di pagine di risultati di "Libero" : ');

    return {
        cdsEmail,
        cdsPassword,
        repubblicaEmail,
        repubblicaPassword,
        query,
        dateRanges,
        liberoPageNumbers
    };
};


// Funzione per leggere input dalla console
const askQuestion = (query) => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => rl.question(query, (answer) => {
        rl.close();
        resolve(answer);
    }));
};

const askHiddenInput = (query) => {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        // Nascondere l'input
        rl.stdoutMuted = true;

        // Imposta la query visibile all'utente
        rl.query = query;

        // Personalizza l'output per nascondere l'input con asterischi
        rl._writeToOutput = (stringToWrite) => {
            if (rl.stdoutMuted) {
                // Mostra il messaggio e aggiungi un asterisco per ogni carattere digitato
                rl.output.write(`\x1B[2K\x1B[200D${rl.query}${'*'.repeat(rl.line.length)}`);
            } else {
                rl.output.write(stringToWrite);
            }
        };

        // Richiedi l'input
        rl.question(rl.query, (password) => {
            console.log('\n'); // Vai a capo dopo il completamento
            rl.close();
            resolve(password);
        });
    });
};

const initializePage = async (browser) => {
    const blockedURLs = [
        'services.insurads.com',
        'securepubads.g.doubleclick.net',
        'dt.adsafeprotected.com',
        'metrics.brightcove.com',
        'oasjs.kataweb.it',
        'pagead2.googlesyndication.com',
        'www.googleadservices.com',
        'secure-it.imrworldwide.com',
        'jadsver.postrelease.com',
        'simage2.pubmatic.com',
        'criteo-sync.teads.tv',
        'sync-criteo.ads.yieldmo.com',
        'cdn.insurads.com',
        'c.amazon-adsystem.com',
        'fundingchoicesmessages.google.com',
        'pubads.g.doubleclick.net',
        'advertiser.wbrtk.net/js/prebid-ads.js',
        'des.smartclip.net'
    ];

    try {
        // Crea una nuova pagina
        const page = await browser.newPage();

        // Imposta il viewport sulla pagina
        await page.setViewport({
            width: 1920,
            height: 1080,
            deviceScaleFactor: 1
        });

        // Attiva l'intercettazione delle richieste
        await page.setRequestInterception(true);

        // Gestisce il blocco di URL specifici
        page.on('request', (request) => {
            const url = request.url();
            if (blockedURLs.some(blocked => url.includes(blocked))) {
                request.abort(); // Blocca la richiesta
            } else {
                request.continue(); // Continua con le altre richieste
            }
        });

        return page;
    } catch (error) {
        console.error("Errore durante l'inizializzazione della pagina:", error.message);
        throw error;
    }
};

const initializeBrowser = async () => {
    try {
        // Avvia il browser
        const browser = await puppeteer.launch({ headless: false });
        await sleep(3000);
        return browser;
    } catch (error) {
        console.error("Errore durante l'inizializzazione del browser:", error.message);
        throw error; // Rilancia l'errore se non è possibile inizializzare il browser
    }
};


const getTitle = async (page, journal) => {
    const cdsSelectors = ['h1.title-art-hp', 'h1.title-art', 'h1.article-title', 'h1.title']; // Lista dei possibili selettori
    const repubblicaSelectors = ['article h1'];
    const liberoSelectors = ['.article h1'];
    const selectors = journal === 'cds' ? cdsSelectors : (journal === 'repubblica' ? repubblicaSelectors : liberoSelectors);

    for (const selector of selectors) {
        console.log('Ricerca titolo con selettore ' + selector + ' in corso...')

        try {

            // Aspetta che il selettore sia presente
            await page.waitForSelector(selector, { timeout: 2000 });
    
            // Ritorna il titolo estratto
            const title = await page.$eval(selector, el => el.textContent.trim());
            if (title) return sanitizeHtml(title); // Restituisci il titolo se trovato

        } catch {}
    }

    // Se nessun titolo è stato trovato, lancia un errore
    throw new Error('Nessun titolo trovato.');
};

const getDates = async (page, journal) => {
    const cdsSelectors = ['p.is-last-update', 'p.media-news-date', '.article-date-place', "p.is-copyright"]; // Lista dei selettori per il datetime
    const liberoSelectors = ['.article-data time'];
    const selectors = journal === 'cds' ? cdsSelectors : liberoSelectors;

    for (const selector of selectors) {
        console.log('Ricerca data con selettore ' + selector + ' in corso...')

        try {
            // Aspetta che il selettore sia presente
            await page.waitForSelector(selector, { timeout: 2000 });

            let date;
            switch (selector) {
                case 'p.is-last-update':
                case 'p.is-copyright': {
                    // Ritorna il valore del datetime
                    date = await page.$eval(selector, el => el.getAttribute('datetime'));
                }
                default: {
                    date = await page.$eval(selector, el => el.textContent.trim());
                }
            }

            if (date) return extractDates(date); // Restituisci il datetime se trovato
        } catch {}
    }

    // Se nessun datetime è stato trovato, lancia un errore
    throw new Error('Nessuna data trovata.');
};

const getText = async (page, journal) => {
    const cdsSelectors = ['div.content > *', 'div.chapter > *']; // Selettori per tutti i figli di div.content e div.chapter
    const repubblicaSelectors = ['article .story__text > *', 'article .detail_summary', 'article > *']; // Selettori per Repubblica
    const liberoSelectors = ['.video-description > p', '.article section > *'];
    const selectors = journal === 'cds' ? cdsSelectors : (journal === 'repubblica' ? repubblicaSelectors : liberoSelectors);

    for (const selector of selectors) {
        console.log('Ricerca testo con selettore ' + selector + ' in corso...')
        try {
            // Aspetta che il selettore sia presente
            await page.waitForSelector(selector, { timeout: 1000 });

            let text;

            if (journal === 'cds' || journal === 'libero') {
                text = await page.$$eval(selector, elements =>
                    elements
                        .filter(el => {
                            // Filtra solo i tag desiderati
                            if (el.tagName === 'P') {
                                return (
                                    el.classList.length === 0 || el.classList.contains('chapter-paragraph')
                                );
                            }
                            return ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(el.tagName);
                        })
                        .map(el => 
                            el.textContent
                              .trim()
                              .replace(/\s+/g, ' ') // Rimuovi spazi multipli
                              .replace(/Dai blog/gi, '') // Rimuovi "Dai blog" in modo case insensitive
                        )
                        .filter(text => text !== '') // Elimina contenuti vuoti
                        .join('\n') // Combina con un "a capo" tra gli elementi
                );
            } else if (journal === 'repubblica') {
                // Gestione per Repubblica
                if (selector === 'article .story__text > *') {
                    text = await page.$$eval(selector, elements =>
                        elements
                            .filter(el => ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(el.tagName))
                            .map(el => el.textContent.trim().replace(/\s+/g, ' '))
                            .filter(text => text !== '')
                            .join('\n')
                    );
                } else if (selector === 'article .detail_summary') {
                    // Estrai il testo direttamente senza filtrare
                    text = await page.$eval(selector, el => el.textContent.trim());
                } else if (selector === 'article > *') {
                    // Filtra i tag rilevanti
                    text = await page.$$eval(selector, elements =>
                        elements
                            .filter(el => ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(el.tagName))
                            .map(el => el.textContent.trim().replace(/\s+/g, ' '))
                            .filter(text => text !== '')
                            .join('\n')
                    );
                }
            }
        
            if (text) return text;
        } catch {}
    }

    // Se nessun testo è stato trovato, lancia un errore
    throw new Error('Nessun testo trovato.');
};

const months = {
    gennaio: 'gen',
    febbraio: 'feb',
    marzo: 'mar',
    aprile: 'apr',
    maggio: 'mag',
    giugno: 'giu',
    luglio: 'lug',
    agosto: 'ago',
    settembre: 'set',
    ottobre: 'ott',
    novembre: 'nov',
    dicembre: 'dic',
};

// Funzione per trasformare una data nel formato "gen2025"
const transformDate = (dateString) => {
    const regex = /(\d{1,2})\s+([a-z]+)\s+(\d{4})/i; // Es. "2 gennaio 2025"
    const match = dateString.match(regex);

    if (match) {
        const month = match[2].toLowerCase(); // Mese
        const year = match[3]; // Anno
        const monthAbbrev = months[month]; // Abbreviazione del mese

        if (monthAbbrev && year) {
            return `${monthAbbrev}${year}`;
        }
    }

    return null; // Restituisce null se la stringa non è valida
};

// Funzione per estrarre e trasformare le date
const extractDates = (dateString) => {
    // Converti la stringa in lowercase
    const lowerCaseString = dateString.toLowerCase();

    // RegEx per trovare le date nel formato "dd mese yyyy"
    const dateRegex = /(\d{1,2})\s+([a-z]+)\s+(\d{4})/gi;

    // Trova tutte le date nella stringa
    const matches = [...lowerCaseString.matchAll(dateRegex)];
    if (matches.length === 0) {
        return { published: null, updated: null }; // Nessuna data trovata
    }

    // La prima data è considerata la data di pubblicazione
    const published = matches[0] ? transformDate(`${matches[0][1]} ${matches[0][2]} ${matches[0][3]}`) : null;

    // L'ultima data (se presente) è considerata la data di ultimo aggiornamento
    const updated = matches.length > 1
        ? transformDate(`${matches[matches.length - 1][1]} ${matches[matches.length - 1][2]} ${matches[matches.length - 1][3]}`)
        : published;

    return { published, updated };
};

const determineEvent = (query) => {
    const eventKeywords = {
        cecchettin: ['cecchettin'],
        castelli: ['castelli']
    };
    // Itera sulle chiavi di `eventKeywords`
    for (const [event, keywords] of Object.entries(eventKeywords)) {
        // Controlla se la query contiene almeno una parola chiave
        if (keywords.some(keyword => query.toLowerCase().includes(keyword.toLowerCase()))) {
            return event; // Restituisci l'evento corrispondente
        }
    }

    // Se nessun evento corrisponde, restituisci la query originale
    return query;
};


// Funzione per gestire il login su Corriere della Sera
const loginCds = async (page, userInputs) => {

    console.log('Login su "Corriere della Sera" in corso...');

    let sessionLoginCds = false;

    // Vai alla pagina di login
    await page.goto('https://www.corriere.it/account/login?landing=https://www.corriere.it/', {
        waitUntil: 'networkidle2',
    });

    // Compila i campi email e password
    await page.type('input[name="email"]', userInputs.cdsEmail);
    await page.type('input[name="password"]', userInputs.cdsPassword);

    // Clicca sul pulsante di login
    await page.click('button[type="submit"]');

    // Aspetta che il login sia completato
    try {
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 });
        consoleSuccess('Login su "Corriere della Sera" completato.');
        sessionLoginCds = true;
    } catch {
        console.error('Login su "Corriere della Sera" non riuscito o timeout raggiunto.');
    }
    await sleep(3000); // Pausa tra le pagine
    return sessionLoginCds;
};

// Funzione per gestire il login su La Repubblica
const loginRepubblica = async (page, userInputs) => {

    console.log('Login su "La Repubblica" in corso...');

    let sessionLoginRepubblica = false;

    await page.goto('https://repubblica.it', {
        waitUntil: 'networkidle2',
    });

    // Nascondi il banner e ottieni le coordinate per il clic
    const loginCoordinates = await page.evaluate(() => {
        // Nascondi il banner di iubenda
        const iubendaBanner = document.querySelector('#iubenda-cs-banner');
        if (iubendaBanner) {
            iubendaBanner.style.display = 'none'; // Nascondi il banner
        }

        // Trova l'elemento login
        const loginElement = document.querySelector('#account-data-container');

        // Ottieni le coordinate del centro dell'elemento
        const loginRect = loginElement.getBoundingClientRect();
        return {
            x: loginRect.left + loginRect.width / 2, // Centro X
            y: loginRect.top + loginRect.height / 2  // Centro Y
        };
    });

    if (!loginCoordinates) return sessionLoginRepubblica;

    await page.mouse.click(loginCoordinates.x, loginCoordinates.y);

    await sleep(10000);

    // Clicca al centro dello username
    await page.mouse.click(1200, 300);
    await page.keyboard.type(userInputs.repubblicaEmail, { delay: 100 }); // Simula digitazione lenta

    // Clicca al centro della password
    await page.mouse.click(1200, 360);
    await page.keyboard.type(userInputs.repubblicaPassword, { delay: 100 }); // Simula digitazione lenta

    // Clicca al centro del bottone
    await page.mouse.click(1200, 550);

    // Aspetta che il login sia completato
    try {
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 });
        consoleSuccess('Login su "La Repubblica" completato.');
        sessionLoginRepubblica = true;
    } catch {
        console.error('Login su "La Repubblica" non riuscito o timeout raggiunto.');
    }
    await sleep(10000); // Pausa tra le pagine
    return sessionLoginRepubblica;
};

// Funzione per aggiungere un timeout
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const refreshBrowser = async () => {
    // Reinizializza il browser
    const browser = await initializeBrowser();
    await sleep(3000);
    let page = await initializePage(browser);
    return { browser, page }
}

const refreshBrowserAndLogin = async (userInputs) => {
    let { browser, page } = await refreshBrowser();

    const maxRetries = 10; // Numero massimo di tentativi per i login
    let loginAttempts = 0;
    let cdsLoginSuccess = false;
    let repubblicaLoginSuccess = false;

    // Tentativi di login su "Corriere della Sera"
    while (loginAttempts < maxRetries && !cdsLoginSuccess) {
        try {
            consoleInfo(`Tentativo di login su "Corriere della Sera" (${loginAttempts + 1}/${maxRetries})...`);

            cdsLoginSuccess = await loginCds(page, userInputs);

            if (!cdsLoginSuccess) {
                throw new Error("Login non riuscito su 'Corriere della Sera'");
            }

        } catch (error) {
            loginAttempts++;
            console.warn(`Tentativo ${loginAttempts}/${maxRetries} di login fallito su "Corriere della Sera": ${error.message}`);

            if (loginAttempts >= maxRetries) {
                const errorMessage = `Errore massimo tentativi raggiunti per il login su "Corriere della Sera": ${error.message}`;
                console.warn(errorMessage);
                await browser.close();
                throw new Error(errorMessage); // Interrompi il processo
            } else {
                if (page && !page.isClosed()) {
                    await page.close(); // Chiudi la scheda corrente
                }
                page = await initializePage(browser); // Apri una nuova scheda
                await sleep(3000); // Attesa prima di riprovare
            }
        }
    }

    await sleep(3000);

    // Esegui il login su "La Repubblica"
    while (loginAttempts < maxRetries && !repubblicaLoginSuccess) {
        try {
            consoleInfo(`Tentativo di login su "La Repubblica" (${loginAttempts + 1}/${maxRetries})...`);
            repubblicaLoginSuccess = await loginRepubblica(page, userInputs);
            if (!repubblicaLoginSuccess) {
                throw new Error('Login non riuscito su "La Repubblica"');
            }

        } catch (error) {
            loginAttempts++;
            console.warn(`Tentativo ${loginAttempts}/${maxRetries} di login fallito su "La Repubblica": ${error.message}`);

            if (loginAttempts >= maxRetries) {
                const errorMessage = `Errore massimo tentativi raggiunti per il login su "La Repubblica": ${error.message}`;
                console.warn(errorMessage);
                await browser.close();
                throw new Error(errorMessage); // Interrompi il processo
            } else {
                if (page && !page.isClosed()) {
                    await page.close(); // Chiudi la scheda corrente
                }
                page = await initializePage(browser); // Apri una nuova scheda
                await sleep(3000); // Attesa prima di riprovare
            }
        }
    }

    return { browser, page };
};



const cdsScaper = async (userInputs, query) => {
    const cdsScraperNews = [];
    const cdsScraperErrors = [];
    const maxRetries = 10;

    consoleInfo(`Ricerca su "Corriere della Sera" per query "${query}" in corso...`);

    let page;
    let browser;

    // Inizializza il browser e la pagina
    try {
        const session = await refreshBrowserAndLogin(userInputs);
        browser = session.browser;
        page = session.page;
    } catch (error) {
        console.error(`Errore durante l'inizializzazione del browser o il login: ${error.message}`);
        return { cdsScraperNews, cdsScraperErrors };
    }

    let attempts = 0;
    let lastPageNumber = 0;
    let pageFetchSuccess = false;

    // Tentativi per ottenere il numero di pagine
    while (attempts < maxRetries && !pageFetchSuccess) {
        try {
            const url = `https://www.corriere.it/ricerca/?q=${query}`;
            await page.goto(url, { waitUntil: 'networkidle2' });
            await sleep(3000); // Attesa esplicita

            await page.waitForSelector('.pagination-list', { timeout: 10000 });

            lastPageNumber = await page.$eval('.pagination-list li:last-child a', el =>
                parseInt(el.textContent.trim(), 10)
            );

            if (lastPageNumber > 0) {
                consoleSuccess(`Sono state trovate ${lastPageNumber} pagina/e di risultati su "Corriere della Sera" per la query "${query}".`);
            } else {
                console.warn(`Non sono stati trovati risultati su "Corriere della Sera" per la query "${query}".`);
            }

            pageFetchSuccess = true;
        } catch (error) {
            attempts++;
            console.warn(`Tentativo ${attempts}/${maxRetries} fallito per ottenere il numero di pagine su "Corriere della Sera": ${error.message}`);

            if (attempts >= maxRetries) {
                const errorMessage = `Errore massimo tentativi raggiunti per ottenere il numero di pagine su "Corriere della Sera": ${error.message}`;
                cdsScraperErrors.push(errorMessage);
                console.warn(errorMessage);
                return { cdsScraperNews, cdsScraperErrors }; // Interrompi il processo
            } else {
                if (page && !page.isClosed()) {
                    await page.close();
                }
                if (browser && browser.connected) {
                    await browser.close();
                }
                try {
                    const session = await refreshBrowserAndLogin(userInputs);
                    browser = session.browser;
                    page = session.page;
                } catch (refreshError) {
                    console.error(`Errore durante il recupero della sessione: ${refreshError.message}`);
                    return { cdsScraperNews, cdsScraperErrors };
                }
                await sleep(3000); // Attesa prima di riprovare
            }
        }
    }

    if (lastPageNumber === 0) return { cdsScraperNews, cdsScraperErrors };

    for (let i = 1; i <= lastPageNumber; i++) {
        const urlWithPage = `https://www.corriere.it/ricerca/?q=${query}&page=${i}`;

        try {
            await page.goto(urlWithPage, { waitUntil: 'networkidle2' });
            await sleep(2000);

            await page.waitForSelector('.paginationResult', { timeout: 10000 });

            const links = await page.$$eval('.bck-media-news-signature h3 a', anchors =>
                anchors.map(anchor => anchor.href)
            );

            consoleInfo(`Trovati ${links.length} articoli nella pagina ${i} su "Corriere della Sera".`);

            for (const link of links) {
                let articleAttempts = 0;
                let articleFetchSuccess = false;
                let title, date, text, event;

                while (articleAttempts < maxRetries && !articleFetchSuccess) {
                    try {
                        await page.goto(link, { waitUntil: 'networkidle2' });
                        await sleep(2000);
                        
                        

                        await page.waitForSelector('h1', { timeout: 10000 });
                        articleFetchSuccess = true;
                    } catch (error) {
                        articleAttempts++;
                        console.warn(`Tentativo ${articleAttempts}/${maxRetries} fallito per articolo su "Corriere della Sera": ${link} - ${error.message}`);

                        if (articleAttempts >= maxRetries) {
                            const errorMessage = `Errore massimo tentativi raggiunti per articolo su "Corriere della Sera": ${link} - ${error.message}`;
                            cdsScraperErrors.push(errorMessage);
                            console.warn(errorMessage);
                        } else {
                            if (page && !page.isClosed()) {
                                await page.close();
                            }
                            if (browser && browser.connected) {
                                await browser.close();
                            }
                            try {
                                const session = await refreshBrowserAndLogin(userInputs);
                                browser = session.browser;
                                page = session.page;
                            } catch (refreshError) {
                                console.error(`Errore durante il recupero della sessione: ${refreshError.message}`);
                                return { cdsScraperNews, cdsScraperErrors };
                            }
                            await sleep(3000); // Attesa prima di riprovare
                        }
                    }

                    if (articleFetchSuccess) {
                        try {
                            title = await getTitle(page, 'cds');
                            const { published, updated } = await getDates(page, 'cds');
                            date = updated || published;
                            text = await getText(page, 'cds');
                            event = determineEvent(query);
    
                            cdsScraperNews.push({
                                id: cdsScraperNews.length + 1,
                                journal: 'cds',
                                event,
                                date,
                                title,
                                text,
                                link,
                            });
    
                            consoleSuccess(`Articolo aggiunto su "Corriere della Sera": ${title}`);
                        } catch (error) {
                            console.warn(`Errore durante l'estrazione dei dati per l'articolo su "Corriere della Sera": ${link} - ${error.message}`);
                            cdsScraperErrors.push(`Errore nell'estrazione dei dati per l'articolo ${link}: ${error.message}`);
                        }
                    }
                }
            }
        } catch (error) {
            const errorMessage = `Errore durante il processamento della pagina ${i} su "Corriere della Sera": ${error.message}`;
            cdsScraperErrors.push(errorMessage);
            console.warn(errorMessage);
            if (page && !page.isClosed()) {
                await page.close();
            }
            if (browser && browser.connected) {
                await browser.close();
            }
            try {
                const session = await refreshBrowserAndLogin(userInputs);
                browser = session.browser;
                page = session.page;
            } catch (refreshError) {
                console.error(`Errore durante il recupero della sessione: ${refreshError.message}`);
                return { cdsScraperNews, cdsScraperErrors };
            }

        }

        consoleInfo(`Pagina ${i}/${lastPageNumber} su "Corriere della Sera" processata con successo.`);
    }

    if (page && !page.isClosed()) {
        await page.close();
    }

    if (browser && browser.connected) {
        await browser.close();
    }
    
    return { cdsScraperNews, cdsScraperErrors };
};

const repubblicaScraper = async (userInputs, query, dateRange) => {
    const repubblicaScraperNews = [];
    const repubblicaScraperErrors = [];
    const maxRetries = 10;

    consoleInfo(`Ricerca su "La Repubblica" per query "${query}" in corso...`);

    let page;
    let browser;

    // Inizializza il browser e la pagina
    try {
        const session = await refreshBrowserAndLogin(userInputs);
        browser = session.browser;
        page = session.page;
    } catch (error) {
        console.error(`Errore durante l'inizializzazione del browser o il login: ${error.message}`);
        return { repubblicaScraperNews, repubblicaScraperErrors };
    }

    let attempts = 0;
    let lastPageNumber = 0;
    let pageFetchSuccess = false;

    // Configura gli intervalli di date
    const startDate = new Date(dateRange.fromDate);
    const endDate = new Date(dateRange.toDate);
    const intervalDays = 50; // Suddividi in intervalli di 100 giorni

    const intervalRanges = [];
    let currentEndDate = new Date(endDate);

    while (currentEndDate > startDate) {
        const currentStartDate = new Date(currentEndDate);
        currentStartDate.setDate(currentStartDate.getDate() - intervalDays);
        if (currentStartDate < startDate) {
            currentStartDate.setTime(startDate.getTime());
        }

        intervalRanges.push({
            fromDate: currentStartDate.toISOString().split('T')[0],
            toDate: currentEndDate.toISOString().split('T')[0],
        });

        // Sposta all'intervallo precedente
        currentEndDate.setDate(currentEndDate.getDate() - intervalDays - 1);
    }

    for (const range of intervalRanges) {
        // Tentativi per ottenere il numero di pagine
        while (attempts < maxRetries && !pageFetchSuccess) {
            try {
                const url = `https://ricerca.repubblica.it/ricerca/repubblica?query=${query}&fromdate=${range.fromDate}&todate=${range.toDate}&sortby=ddate&mode=all`;
                await page.goto(url, { waitUntil: 'networkidle2' });
                await sleep(3000);

                await page.waitForSelector('.pagination', { timeout: 10000 });

                lastPageNumber = await page.$eval('.pagination p', el => {
                    const match = el.textContent.match(/di\s+(\d+)/);
                    return match ? parseInt(match[1], 10) : 0;
                });

                if (lastPageNumber > 0) {
                    consoleSuccess(`Sono state trovate ${lastPageNumber} pagina/e di risultati su "La Repubblica" per la query "${query}" dal ${range.fromDate} al ${range.toDate}.`);
                } else {
                    console.warn(`Non sono stati trovati risultati su "La Repubblica" per la query "${query} dal ${range.fromDate} al ${range.toDate}.".`);
                }

                pageFetchSuccess = true;
            } catch (error) {
                attempts++;
                console.warn(`Tentativo ${attempts}/${maxRetries} fallito per ottenere il numero di pagine su "La Repubblica" dal ${range.fromDate} al ${range.toDate}: ${error.message}`);

                if (attempts >= maxRetries) {
                    const errorMessage = `Errore massimo tentativi raggiunti per ottenere il numero di pagine su "La Repubblica" dal ${range.fromDate} al ${range.toDate}: ${error.message}`;
                    repubblicaScraperErrors.push(errorMessage);
                    console.warn(errorMessage);
                    return { repubblicaScraperNews, repubblicaScraperErrors };
                } else {
                    if (page && !page.isClosed()) {
                        await page.close();
                    }
                    if (browser && browser.connected) {
                        await browser.close();
                    }
                    try {
                        const session = await refreshBrowserAndLogin(userInputs);
                        browser = session.browser;
                        page = session.page;
                    } catch (refreshError) {
                        console.error(`Errore durante il recupero della sessione: ${refreshError.message}`);
                        return { cdsScraperNews, cdsScraperErrors };
                    }
                    await sleep(3000); // Attesa prima di riprovare
                }
            }
        }

        if (lastPageNumber === 0) return { repubblicaScraperNews, repubblicaScraperErrors };

        consoleInfo(`Ricerco articoli tra ${range.fromDate} e ${range.toDate}...`);
        // Scraping delle pagine principali e articoli
        for (let i = 1; i <= lastPageNumber; i++) {
            const urlWithPage = `https://ricerca.repubblica.it/ricerca/repubblica?query=${query}&page=${i}&fromdate=${range.fromDate}&todate=${range.toDate}&sortby=ddate&mode=all`;

            try {
                await page.goto(urlWithPage, { waitUntil: 'networkidle2' });
                await sleep(2000);

                await page.waitForSelector('#n-risultati', { timeout: 10000 });

                const articles = await page.$$eval('#lista-risultati article h1 a', (anchors) => {
                    return anchors.map(anchor => {
                        const article = {
                            link: anchor.href, // Link all'articolo
                        };
        
                        // Trova il contenitore dell'articolo per cercare le date
                        const container = anchor.closest('article'); // Assumi che gli articoli siano racchiusi in <article>
                        if (container) {
                            // Cerca le date in "aside.correlati"
                            const correlati = container.querySelector('aside.correlati a time');
                            const correlatiExtra = container.querySelector('aside.correlati-extra a time');
                            let date;
        
                            if (correlati) {
                                date = correlati.textContent.trim();
                            }
        
                            if (correlatiExtra) {
                                date = correlatiExtra.textContent.trim();
                            }
        
                            // Aggiungi tutte le date trovate
                            article.date = date;
                        }
        
                        return article;
                    });
                });

                consoleInfo(`Trovati ${Object.keys(articles).length} articoli nella pagina ${i} su "La Repubblica".`);

                for (const article of articles) {
                    let articleAttempts = 0;
                    let articleFetchSuccess = false;
                    let title, text, event;

                    while (articleAttempts < maxRetries && !articleFetchSuccess) {
                        try {
                            await page.goto(article.link, { waitUntil: 'networkidle2' });
                            await sleep(2000);

                            await page.waitForSelector('h1', { timeout: 10000 });

                            // Controlla se esiste il link "Log In"
                            const loginPresent = await page.evaluate(() => {
                                const loginElement = document.querySelector('a.dropdown-item[href="/mma"]');
                                return !!loginElement;
                            });
                            
                            if (loginPresent) {
                                if (page && !page.isClosed()) {
                                    await page.close();
                                }
                                if (browser && browser.connected) {
                                    await browser.close();
                                }
                                try {
                                    const session = await refreshBrowserAndLogin(userInputs);
                                    browser = session.browser;
                                    page = session.page;
                                    // Ripeti il caricamento della stessa pagina dopo il login
                                    await page.goto(article.link, { waitUntil: 'networkidle2' });
                                    await sleep(2000);
                                    await page.waitForSelector('h1', { timeout: 10000 });
                                } catch (refreshError) {
                                    console.error(`Errore durante il recupero della sessione: ${refreshError.message}`);
                                    throw new Error(`Recupero sessione fallito per ${article.link}: ${refreshError.message}`);
                                }
                                await sleep(3000); // Attesa prima di riprovare
                            }

                            articleFetchSuccess = true;
                        } catch (error) {
                            articleAttempts++;
                            console.warn(`Tentativo ${articleAttempts}/${maxRetries} fallito per articolo su "La Repubblica": ${article.link} - ${error.message}`);

                            if (articleAttempts >= maxRetries) {
                                const errorMessage = `Errore massimo tentativi raggiunti per articolo su "La Repubblica": ${article.link} - ${error.message}`;
                                repubblicaScraperErrors.push(errorMessage);
                                console.warn(errorMessage);
                            } else {
                                if (page && !page.isClosed()) {
                                    await page.close();
                                }
                                if (browser && browser.connected) {
                                    await browser.close();
                                }
                                try {
                                    const session = await refreshBrowserAndLogin(userInputs);
                                    browser = session.browser;
                                    page = session.page;
                                } catch (refreshError) {
                                    console.error(`Errore durante il recupero della sessione: ${refreshError.message}`);
                                    return { cdsScraperNews, cdsScraperErrors };
                                }
                                await sleep(3000); // Attesa prima di riprovare
                            }
                        }
                        if (articleFetchSuccess) {
                            try {
                                title = await getTitle(page, 'repubblica');
                                const { published, updated } = extractDates(article.date);
                                text = await getText(page, 'repubblica');
                                event = determineEvent(query);
        
                                repubblicaScraperNews.push({
                                    id: repubblicaScraperNews.length + 1,
                                    journal: 'repubblica',
                                    event,
                                    date: updated || published,
                                    title,
                                    text,
                                    link: article.link,
                                });
        
                                consoleSuccess(`Articolo aggiunto su "La Repubblica": ${title}`);
                            } catch (error) {
                                console.warn(`Errore durante l'estrazione dei dati per l'articolo su "La Repubblica": ${article.link} - ${error.message}`);
                                repubblicaScraperErrors.push(`Errore nell'estrazione dei dati per l'articolo ${article.link}: ${error.message}`);
                            }
                        }
                    }
                }
            } catch (error) {
                const errorMessage = `Errore durante il processamento della pagina ${i} su "La Repubblica": ${error.message}`;
                repubblicaScraperErrors.push(errorMessage);
                console.warn(errorMessage);
                if (page && !page.isClosed()) {
                    await page.close();
                }
                if (browser && browser.connected) {
                    await browser.close();
                }
                try {
                    const session = await refreshBrowserAndLogin(userInputs);
                    browser = session.browser;
                    page = session.page;
                } catch (refreshError) {
                    console.error(`Errore durante il recupero della sessione: ${refreshError.message}`);
                    return { cdsScraperNews, cdsScraperErrors };
                }
                await sleep(3000); // Attesa prima di riprovare
            }

            consoleInfo(`Pagina ${i}/${lastPageNumber} su "La Repubblica" processata con successo.`);
        }
    }

    if (page && !page.isClosed()) {
        await page.close();
    }

    if (browser && browser.connected) {
        await browser.close();
    }

    return { repubblicaScraperNews, repubblicaScraperErrors };
};



const liberoScraper = async (query, liberoPageNumber) => {
    const liberoScraperNews = [];
    const liberoScraperErrors = [];
    const maxRetries = 10;

    consoleInfo(`Ricerca su "Libero" per query "${query}" in corso...`);

    let page;
    let browser;

    try {
        const session = await refreshBrowser();
        browser = session.browser;
        page = session.page;
    } catch (error) {
        console.error(`Errore durante l'inizializzazione del browser: ${error.message}`);
        return { liberoScraperNews, liberoScraperErrors };
    }

    const lastPageNumber = liberoPageNumber;

    if (lastPageNumber > 0) {
        consoleSuccess(`Sono state trovate ${lastPageNumber} pagina/e di risultati su "Libero" per la query "${query}".`);
    } else {
        console.warn(`Non sono stati trovati risultati su "Libero" per la query "${query}".`);
        return { liberoScraperNews, liberoScraperErrors };
    }

    for (let i = 1; i <= lastPageNumber; i++) {
        const urlWithPage = `https://www.liberoquotidiano.it/tag/${query}/page/${i}/`;
        let title, text, event;

        try {
            await page.goto(urlWithPage, { waitUntil: 'networkidle2' });
            await sleep(2000);

            await page.waitForSelector('.news-list-container');

            const links = await page.$$eval('header > a:not(.share-button)', anchors =>
                anchors.map(anchor => anchor.href)
            );

            for (const link of links) {
                let articleAttempts = 0;
                let articleSuccess = false;

                while (articleAttempts < maxRetries && !articleSuccess) {
                    try {
                        await page.goto(link, { waitUntil: 'networkidle2' });
                        await sleep(2000);

                        await page.waitForSelector('h1', { timeout: 10000 });
                        articleSuccess = true;
                    } catch (error) {
                        articleAttempts++;
                        console.warn(`Tentativo ${articleAttempts}/${maxRetries} fallito per articolo su "Libero": ${link} - ${error.message}`);

                        if (articleAttempts >= maxRetries) {
                            const errorMessage = `Errore massimo tentativi raggiunti per articolo su "Libero": ${link} - ${error.message}`;
                            liberoScraperErrors.push(errorMessage);
                            console.warn(errorMessage);
                        } else {
                            if (page && !page.isClosed()) {
                                await page.close();
                            }
                            if (browser && browser.connected) {
                                await browser.close();
                            }
                            try {
                                const session = await refreshBrowser();
                                browser = session.browser;
                                page = session.page;
                            } catch (error) {
                                console.error(`Errore durante il recupero della sessione: ${error.message}`);
                                return { liberoScraperNews, liberoScraperErrors };
                            }
                            await sleep(3000);
                        }
                    }
                    if (articleSuccess) {
                        try {
                            title = await getTitle(page, 'libero');
                            const { published, updated } = getDates(page, 'libero');
                            text = await getText(page, 'libero');
                            event = determineEvent(query);
            
                            liberoScraperNews.push({
                                id: liberoScraperNews.length + 1,
                                journal: 'libero',
                                event,
                                date: updated || published,
                                title,
                                text,
                                link,
                            });
    
                            consoleSuccess(`Articolo aggiunto su "Libero": ${title}`);
    
                        } catch (error) {
                            console.warn(`Errore durante l'estrazione dei dati per l'articolo su "Libero": ${link} - ${error.message}`);
                            liberoScraperErrors.push(`Errore nell'estrazione dei dati per l'articolo ${link}: ${error.message}`);
                        }
                    }
                }
            }
        } catch (error) {
            const errorMessage = `Errore durante il processamento della pagina ${i} su "Libero": ${error.message}`;
            liberoScraperErrors.push(errorMessage);
            console.warn(errorMessage);
            if (page && !page.isClosed()) {
                await page.close();
            }
            if (browser && browser.connected) {
                await browser.close();
            }
            try {
                const session = await refreshBrowser();
                browser = session.browser;
                page = session.page;
            } catch (error) {
                console.error(`Errore durante il recupero della sessione: ${error.message}`);
                return { liberoScraperNews, liberoScraperErrors };
            }
            await sleep(3000); // Attesa prima di riprovare
        }
        consoleInfo(`Pagina ${i}/${lastPageNumber} su "Libero" processata con successo.`);
    }

    if (page && !page.isClosed()) {
        await page.close();
    }

    if (browser && browser.connected) {
        await browser.close();
    }

    return { liberoScraperNews, liberoScraperErrors };
};


(async () => {
    try {
        console.log('--- JOURNAL SCRAPER ---');

        const allCdsScraperNews = [];
        const allCdsScraperErrors = {};
        const allRepubblicaScraperNews = [];
        const allRepubblicaScraperErrors = {}
        const allLiberoScraperNews = [];
        const allLiberoScraperErrors = {};

        // Chiedi parametri in input all'utente
        const userInputs = await collectUserInputs();

        consoleInfo(`Ricerca per query "${userInputs.query}" in corso.. `);
        const queries = userInputs.query.split(',').map((query) => query.trim());

        const dateRanges = userInputs.dateRanges.split(',').map((dateRange) => {
            const [fromDate, toDate] = dateRange.trim().split('/');
            return {
                fromDate: fromDate.trim(),
                toDate: toDate.trim(),
            };
        });

        const liberoPageNumbers = userInputs.liberoPageNumbers.split(',').map((query) => parseInt(query.trim()));
        
        for (const [index, query] of queries.entries()) {
            const { cdsScraperNews, cdsScraperErrors } = await cdsScaper(userInputs, query);
            allCdsScraperNews.push(cdsScraperNews);
            allCdsScraperErrors[query] = cdsScraperErrors;
            const dateRange = (dateRanges && dateRanges[index]) || {fromDate: '2024-01-01', toDate: '2025-01-01'};
            const { repubblicaScraperNews, repubblicaScraperErrors } = await repubblicaScraper(userInputs, query, dateRange);
            allRepubblicaScraperNews.push(repubblicaScraperNews);
            allRepubblicaScraperErrors[query] = repubblicaScraperErrors;
            const liberoPageNumber = liberoPageNumbers[index] || 1;
            const { liberoScraperNews, liberoScraperErrors } = await liberoScraper(query, liberoPageNumber);
            allLiberoScraperNews.push(liberoScraperNews);
            allLiberoScraperErrors[query] = liberoScraperErrors;
        }


        // Configurazione di csv-writer
        const csvWriter = createObjectCsvWriter({
            path: 'notizie.csv', // Nome del file di output
            header: [
                { id: 'id', title: '*ID_' },
                { id: 'journal', title: '*TIPOQ_' },
                { id: 'event', title: '*CASO_' },
                { id: 'date', title: '*DATA_'},
                { id: 'title', title: '*TITOLO_' },
                { id: 'text', title: '*TXT_' },
                { id: 'link', title: '*LINK_' },
            ],
        });

        // Combina tutte le news in un array piatto
        const allNews = [
            ...allCdsScraperNews,
            ...allRepubblicaScraperNews,
            ...allLiberoScraperNews
        ].flat();

        // Assegna un ID numerico decrescente
        const totalNews = allNews.length; // Conta il totale delle news
        const allNewsWithIds = allNews.map((news, index) => ({
            ...news,
            id: totalNews - index // Genera ID decrescente
        }));

        // Salva tutti i dati raccolti in un unico CSV
        await csvWriter.writeRecords(allNewsWithIds);
    
        consoleSuccess('Dati salvati su file "notizie.csv".');

        const scraperErrors = {
            'Corriere della Sera': allCdsScraperErrors,
            'La Repubblica': allRepubblicaScraperErrors,
            'Libero': allLiberoScraperErrors
        };

        Object.entries(scraperErrors).forEach(([source, errors]) => {
            // Verifica se l'oggetto `errors` ha chiavi (cioè contiene errori)
            const hasErrors = Object.values(errors).some(errorArray => errorArray.length > 0);
        
            if (hasErrors) {
                console.warn(`Articoli andati in errore su "${source}":`);
                
                // Itera su ogni categoria di errore all'interno di `errors`
                Object.entries(errors).forEach(([query, errorArray]) => {
                    if (errorArray.length > 0) {
                        console.warn(`Errore per la query "${query}" (${errorArray.length} articoli):`);
                        console.warn(JSON.stringify(errorArray, null, 2));
                    }
                });
            }
        });

    } catch (error) {
        console.error('Errore durante l’estrazione delle notizie:', error.message);
    }
})();