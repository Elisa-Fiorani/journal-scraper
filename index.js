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

    return {
        cdsEmail,
        cdsPassword,
        repubblicaEmail,
        repubblicaPassword,
        query,
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


const getTitle = async (page, journal) => {
    const cdsSelectors = ['h1.title-art-hp', 'h1.title-art', 'h1.article-title', 'h1.title']; // Lista dei possibili selettori
    const repubblicaSelectors = ['article h1'];
    const selectors = journal === 'cds' ? cdsSelectors : repubblicaSelectors;

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

const getDates = async (page) => {
    const selectors = ['p.is-last-update', 'p.media-news-date', '.article-date-place', "p.is-copyright"]; // Lista dei selettori per il datetime
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
    const selectors = journal === 'cds' ? cdsSelectors : repubblicaSelectors;

    for (const selector of selectors) {
        console.log('Ricerca testo con selettore ' + selector + ' in corso...')
        try {
            // Aspetta che il selettore sia presente
            await page.waitForSelector(selector, { timeout: 1000 });

            let text;

            if (journal === 'cds') {
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
                        .map(el => el.textContent.trim().replace(/\s+/g, ' ')) // Rimuovi spazi multipli per ogni elemento
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
        'fundingchoicesmessages.google.com'
    ];
    
    await page.setRequestInterception(true);
    
    page.on('request', (request) => {
        const url = request.url();
        if (blockedURLs.some(blocked => url.includes(blocked))) {
            request.abort(); // Blocca la richiesta
        } else {
            request.continue(); // Continua con le altre richieste
        }
    });

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

const cdsScaper = async (page, userInputs, query) => {
    const cdsScraperNews = [];
    const cdsScraperErrors = [];
    
    // Eseguo il login sulla fonte delle notizie
    const sessionLoginCds = await loginCds(page, userInputs);

    if (!sessionLoginCds) return { cdsScraperNews, cdsScraperErrors };

    consoleInfo(`Ricerca su "Corriere della Sera" per query "${query}" in corso...`);
    
    const url = `https://www.corriere.it/ricerca/?q=${query}`;

    // Vai alla pagina specificata
    await page.goto(url, { waitUntil: 'networkidle2' });

    // Aspetta che il contenuto delle notizie sia visibile
    await page.waitForSelector('.pagination-list');

    const lastPageNumber = await page.$eval('.pagination-list li:last-child a', el => {
        return parseInt(el.textContent.trim(), 10); // Converte direttamente il testo in un numero
    });

    if (lastPageNumber > 0) {
        consoleSuccess(`Sono state trovate ${lastPageNumber} pagina/e di risultati su "Corriere della Sera" per la query "${query}"`);
    } else {
        console.warn(`Non sono stati trovati risulati su "Corriere della Sera" per la query "${query}"`)
    }

    for (let i = 1; i <= 1; i++) {

        // Definisco l'URL per la fonte di notizie
        const urlWithPage = `https://www.corriere.it/ricerca/?q=${query}&page=${i}`;

        // Vai alla pagina specificata
        await page.goto(urlWithPage, { waitUntil: 'networkidle2' });

        // Aspetta che il contenuto delle notizie sia visibile
        await page.waitForSelector('.paginationResult');

        // Estrai i titoli e i link delle notizie
        const links = await page.$$eval('.bck-media-news-signature h3 a', anchors =>
            anchors.map(anchor => anchor.href)
        );
        
        for (const link of links) {
            try {
                // Vai alla pagina dell'articolo
                await page.goto(link, { waitUntil: 'networkidle2' });

                // Estrarre i dettagli dell'articolo
                const title = await getTitle(page, 'cds');
                const { published, updated } = await getDates(page);
                const date = updated || published;
                const text = await getText(page, 'cds');
                const event = determineEvent(query);

                // Aggiungi i dati estratti all'array globale
                cdsScraperNews.push({
                    id: cdsScraperNews.length + 1,
                    journal: 'cds',
                    event,
                    date,
                    title: title,
                    text: text,
                    link
                });
                
                consoleSuccess(`Articolo aggiunto da "Corriere della Sera": ${title}`);

            } catch (error) {
                const errorMessage = `Errore nell'estrazione dell'articolo: ${link} - ${error.message}`;
                cdsScraperErrors.push(errorMessage)
                console.warn(errorMessage);
            }
            await sleep(3000);
        }

        consoleInfo(`Pagina ${i} su "Corriere della Sera" processata con successo.`);
    }
    return { cdsScraperNews, cdsScraperErrors };

};

const repubblicaScraper = async (page, userInputs) => {
    const repubblicaScraperNews = [];
    const repubblicaScraperErrors = [];

    // Eseguo il login su Repubblica
    const sessionLoginRepubblica = await loginRepubblica(page, userInputs);

    if (!sessionLoginRepubblica) return { repubblicaScraperNews, repubblicaScraperErrors };

    consoleInfo(`Ricerca su "La Repubblica" per query "${query}" in corso...`);

    const url = `https://ricerca.repubblica.it/ricerca/repubblica?query=${query}&fromdate=2000-01-01&todate=2025-01-06&sortby=ddate&mode=all`;

    // Vai alla pagina specificata
    await page.goto(url, { waitUntil: 'networkidle2' });

    // Aspetta che il contenuto delle paginazione sia visibile
    await page.waitForSelector('.pagination');

    const lastPageNumber = await page.$eval('.pagination p', el => {
        // Estrai solo il numero dopo "di"
        const match = el.textContent.match(/di\s+(\d+)/); // Trova il numero dopo "di"
        return match ? parseInt(match[1], 10) : 0; // Converte il numero trovato in un intero
    });

    if (lastPageNumber > 0) {
        consoleSuccess(`Sono state trovate ${lastPageNumber} pagina/e di risultati su "La Repubblica" per la query "${query}"`);
    } else {
        console.warn(`Non sono stati trovati risulati su "La Repubblica" per la query "${query}"`)
    }

    for (let i = 1; i <= 1; i++) {

        // Definisco l'URL per la fonte di notizie
        const urlWithPage = `https://ricerca.repubblica.it/ricerca/repubblica?query=${query}&page=${i}&fromdate=2000-01-01&todate=2025-01-06&sortby=ddate&mode=all`;
        
        // Vai alla pagina specificata
        await page.goto(urlWithPage, { waitUntil: 'networkidle2' });

        // Aspetta che il contenuto delle notizie sia visibile
        await page.waitForSelector('#lista-risultati');

        // Estrai link, titoli e date
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

        for (const article of articles) {
            try {
                // Vai alla pagina dell'articolo
                await page.goto(article.link, { waitUntil: 'networkidle2' });

                // Estrarre i dettagli dell'articolo
                const title = await getTitle(page, 'repubblica');
                const { published, updated } = extractDates(article.date);
                const date = updated || published;
                const text = await getText(page, 'repubblica');
                const event = determineEvent(query);

                // Aggiungi i dati estratti all'array globale
                repubblicaScraperNews.push({
                    id: repubblicaScraperNews.length + 1,
                    journal: 'repubblica',
                    event,
                    date,
                    title: title,
                    text: text,
                    link: article.link
                });
                
                consoleSuccess(`Articolo aggiunto da "La Repubblica" : ${title}`);

            } catch (error) {
                const errorMessage = `Errore nell'estrazione dell'articolo: ${article.link} - ${error.message}`;
                repubblicaScraperErrors.push(errorMessage);
                console.warn(errorMessage);
            }
            await sleep(3000);
        }

        consoleInfo(`Pagina ${i} su "La Repubblica" processata con successo.`);
    }

    return { repubblicaScraperNews, repubblicaScraperErrors };
}

const liberoScraper = async (page) => {
    const liberoScraperNews = [];
    const liberoScraperErrors = [];
    return { liberoScraperNews, liberoScraperErrors };
}

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

        // Avvia il browser
        const browser = await puppeteer.launch({ headless: false });
        
        const page = await browser.newPage();

        // Imposta il viewport sulla pagina
        await page.setViewport({
            width: 1920,
            height: 1080,
            deviceScaleFactor: 1
        });

        consoleInfo(`Ricerca per query "${userInputs.query}" in corso.. `);
        const queries = userInputs.query.split(',');

        for (query of queries) {
            const { cdsScraperNews, cdsScraperErrors } = await cdsScaper(page, userInputs, query);
            allCdsScraperNews.push(cdsScraperNews);
            allCdsScraperErrors[query] = cdsScraperErrors;
            const { repubblicaScraperNews, repubblicaScraperErrors } = await repubblicaScraper(page, userInputs, query);
            allRepubblicaScraperNews.push(repubblicaScraperNews);
            allRepubblicaScraperErrors[query] = repubblicaScraperErrors;
            const { liberoScraperNews, liberoScraperErrors } = await liberoScraper(page);
            allLiberoScraperNews.push(liberoScraperNews);
            allLiberoScraperErrors[query] = liberoScraperErrors;
        }


        // Chiudi il browser
        await browser.close();

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