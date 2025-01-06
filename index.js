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
    // console.log('>> Inserisci le credenziali di login per "Corriere della Sera".');
    // const cdsEmail = await askQuestion('>> Email: ');
    // const cdsPassword = await askHiddenInput('>> Password: ');
    console.log('>> Inserisci le credenziali di login per "La Repubblica".');
    const repubblicaEmail = await askQuestion('>> Email: ');
    const repubblicaPassword = await askHiddenInput('>> Password: ');
    console.log('>> Inserisci la query di ricerca (se più di una separate da ,)');
    const query = (await askQuestion('>> Query di Ricerca: ')).toLowerCase();

    return {
        // cdsEmail,
        // cdsPassword,
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


const getTitle = async (page) => {
    const selectors = ['h1.title-art-hp', 'h1.title-art', 'h1.article-title', 'h1.title']; // Lista dei possibili selettori
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

const getText = async (page) => {
    const selectors = ['div.content > *', 'div.chapter > *']; // Selettori per tutti i figli di div.content e div.chapter

    for (const selector of selectors) {
        console.log('Ricerca testo con selettore ' + selector + ' in corso...')
        try {
            // Aspetta che il selettore sia presente
            await page.waitForSelector(selector, { timeout: 1000 });
        
            // Ottieni e pulisci direttamente il testo
            const text = await page.$$eval(selector, elements =>
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
    } catch {
        console.error('Login su "Corriere della Sera" non riuscito o timeout raggiunto.');
    }
    await sleep(3000); // Pausa tra le pagine
};

// Funzione per gestire il login su La Repubblica
const loginRepubblica = async (page, userInputs) => {

    console.log('Login su "La Repubblica" in corso...');

    // Vai alla pagina di login
    await page.goto('https://login.gedi.it/clp/login.php', {
        waitUntil: 'networkidle2',
    });

    await sleep(2000);

    // Clicca al centro dello username
    await page.mouse.click(1200, 300);
    await page.keyboard.type(userInputs.repubblicaEmail, { delay: 100 }); // Simula digitazione lenta

    // Clicca al centro della password
    await page.mouse.click(1200, 360);
    await page.keyboard.type(userInputs.repubblicaPassword, { delay: 100 }); // Simula digitazione lenta

    // Clicca al centro dell'elemento
    await page.mouse.click(1200, 550);

    await sleep(2000)

    // Aspetta che il login sia completato
    try {
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 });
        consoleSuccess('Login su "La Repubblica" completato.');
    } catch {
        console.error('Login su "La Repubblica" non riuscito o timeout raggiunto.');
    }
    await sleep(3000); // Pausa tra le pagine
};

// Funzione per aggiungere un timeout
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const cdsScaper = async (page, userInputs, query) => {
    const cdsScraperNews = [];
    const cdsScraperErrors = [];
    
    // Eseguo il login sulla fonte delle notizie
    await loginCds(page, userInputs);

    consoleInfo(`Ricerca su Corriere della Sera" per query "${query}" in corso...`);
    
    const url = `https://www.corriere.it/ricerca/?q=${query}`;

    // Vai alla pagina specificata
    await page.goto(url, { waitUntil: 'networkidle2' });

    // Aspetta che il contenuto delle notizie sia visibile
    await page.waitForSelector('.pagination-list');

    const lastPageNumber = parseInt(await page.$eval('.pagination-list li:last-child a', el => {
        return parseInt(el.textContent.trim(), 10); // Converte direttamente il testo in un numero
    }));

    if (lastPageNumber > 0) {
        consoleSuccess(`Sono state trovate ${lastPageNumber} pagina/e di risultati su "Corriere della Sera" per la query "${query}"`);
    } else {
        console.warn(`Non sono stati trovati risulati su "Corriere della Sera" per la query "${query}"`)
    }

    for (let i = 1; i <= lastPageNumber; i++) {

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
                const title = await getTitle(page);
                const { published, updated } = await getDates(page);
                const date = updated || published;
                const text = await getText(page);
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
                
                consoleSuccess(`Articolo aggiunto: ${title}`);

            } catch (error) {
                const errorMessage = `Errore nell'estrazione dell'articolo: ${link} - ${error.message}`;
                cdsScraperErrors.push(errorMessage)
                console.warn(errorMessage);
            }
            await sleep(3000);
        }

        consoleInfo(`Pagina ${i} processata con successo.`);
    }
    return { cdsScraperNews, cdsScraperErrors };

};

const repubblicaScraper = async (page, userInputs) => {
    const repubblicaScraperNews = [];
    const repubblicaScraperErrors = [];

    // Eseguo il login su Repubblica
    await loginRepubblica(page, userInputs);
    return { repubblicaScraperNews, repubblicaScraperErrors };
}

const liberoScraper = async (page) => {
    const liberoScraperNews = [];
    const liberoScraperErrors = [];
    return { liberoScraperNews, liberoScraperErrors };
}

(async () => {
    try {
        console.log('--- ELISA FIORANI | JOURNAL SCRAPER ---');

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

            // const { cdsScraperNews, cdsScraperErrors } = await cdsScaper(page, userInputs, query);
            // allCdsScraperNews.push(cdsScraperNews);
            // allCdsScraperErrors[query] = cdsScraperErrors;
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

        const allNews = [
            ...allCdsScraperNews,
            ...allRepubblicaScraperNews,
            ...allLiberoScraperNews
        ];

        // Salva tutti i dati raccolti in un unico CSV
        await csvWriter.writeRecords(allNews);
    
        consoleSuccess('Dati salvati su file "notizie.csv".');

        if (allCdsScraperErrors.length > 0) {
            console.warn('Articoli andati in errore su "Corriere della Sera" : ', allCdsScraperErrors.length);
            console.warn(JSON.stringify(allRepubblicaScraperErrors));
        }

        if (allRepubblicaScraperErrors.length > 0) {
            console.warn('Articoli andati in errore su "La Repubblica" : ', allRepubblicaScraperErrors.length);
            console.warn(JSON.stringify(allRepubblicaScraperErrors));
        }

        if (allLiberoScraperErrors.length > 0) {
            console.warn('Articoli andati in errore su "Libero" : ', allLiberoScraperErrors.length);
            console.warn(JSON.stringify(allLiberoScraperErrors));
        }

    } catch (error) {
        console.error('Errore durante l’estrazione delle notizie:', error.message);
    }
})();