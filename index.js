const puppeteer = require('puppeteer');
const sanitizeHtml = require('sanitize-html');
const { createObjectCsvWriter } = require('csv-writer');
const readline = require('readline');


// Funzione per raccogliere input in un oggetto
const collectUserInputs = async () => {
    console.log('>> Inserisci le credenziali di login per "Il Corriere della Sera".');
    const email = await askQuestion('>> Email: ');
    const password = await askHiddenInput('>> Password: ');
    console.log('>> Inserisci la query di ricerca');
    const query = (await askQuestion('>> Query di Ricerca: ')).toLowerCase();

    return {
        email,
        password,
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
                await page.waitForSelector(selector, { timeout: 1000 });
        
                // Ritorna il titolo estratto
                const title = await page.$eval(selector, el => el.textContent.trim());
                if (title) return title; // Restituisci il titolo se trovato

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
            await page.waitForSelector(selector, { timeout: 1000 });

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
    const selectors = ['div.content p', 'div.chapter p']; // Lista dei selettori per i paragrafi
    for (const selector of selectors) {
        console.log('Ricerca testo con selettore ' + selector + ' in corso...')
        try {
            // Aspetta che il selettore sia presente
            await page.waitForSelector(selector, { timeout: 1000 });

            // Ritorna il testo concatenato
            const text = await page.$$eval(selector, paragraphs =>
                paragraphs.map(p => p.textContent.trim()).join(' ')
            );
            if (text) return text; // Restituisci il testo se trovato
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
        cecchettin: ['giulia', 'cecchettin'],
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


// Funzione per gestire il login su Corriere
const loginCds = async (page, userInputs) => {

    console.log('Login su "Il Corriere della Sera" in corso...');

    // Vai alla pagina di login
    await page.goto('https://www.corriere.it/account/login?landing=https://www.corriere.it/', {
        waitUntil: 'networkidle2',
    });

    // Compila i campi email e password
    await page.type('input[name="email"]', userInputs.email);
    await page.type('input[name="password"]', userInputs.password);

    // Clicca sul pulsante di login
    await page.click('button[type="submit"]');

    // Aspetta che il login sia completato
    try {
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 });
        console.log('\x1b[32m%s\x1b[0m','Login su "Il Corriere della Sera" completato.');
    } catch {
        console.error('Login su "Il Corriere della Sera" non riuscito o timeout raggiunto.');
    }
    await sleep(5000); // Pausa tra le pagine
};

// Funzione per aggiungere un timeout
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const cdsScaper = async (page, allNews, userInputs) => {
    // Eseguo il login sulla fonte delle notizie
    await loginCds(page, userInputs);

    for (let i = 1; i == 35; i++) {
        // Definisco l'URL per la fonte di notizie
        const url = `https://www.corriere.it/ricerca/?q=${userInputs.query}&page=${i}`;

        // Vai alla pagina specificata
        await page.goto(url, { waitUntil: 'networkidle2' });

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
                const text = await getText(page);
                const event = determineEvent(userInputs.query);


                // Aggiungi i dati estratti all'array globale
                allNews.push({
                    id: allNews.length + 1,
                    journal: 'cds',
                    event,
                    published,
                    updated,
                    title: sanitizeHtml(title),
                    text: sanitizeHtml(text),
                    link
                });
                
                console.log('\x1b[32m%s\x1b[0m', `Articolo aggiunto: ${title}`);

            } catch (error) {
                console.warn(`Errore nell'estrazione dell'articolo: ${link}`, error.message);
            }
            await sleep(5000);
        }

        console.log(`Pagina ${i} processata con successo.`);
        await sleep(5000); // Pausa tra le pagine
    }
};

const repubblicaScraper = async (page, allNews) => {

}

const liberoScraper = async (page, allNews) => {

}

(async () => {
    try {
        // Chiedi parametri in input all'utente
        const userInputs = await collectUserInputs();

        // Array per raccogliere tutti i risultati
        const allNews = [];
        
        // Avvia il browser
        const browser = await puppeteer.launch({ headless: false });
        const page = await browser.newPage();

        await cdsScaper(page, allNews, userInputs);
        await repubblicaScraper(page, allNews);
        await liberoScraper(page, allNews);

        // Configurazione di csv-writer
        const csvWriter = createObjectCsvWriter({
            path: 'notizie.csv', // Nome del file di output
            header: [
                { id: 'id', title: '*ID_' },
                { id: 'journal', title: '*TIPOQ_' },
                { id: 'event', title: '*CASO_' },
                { id: 'published', title: '*DATAPUB_' },
                { id: 'updated', title: '*DATAAGG_'},
                { id: 'title', title: '*TITOLO_' },
                { id: 'text', title: '*TXT_' },
                { id: 'link', title: '*LINK_' },
            ],
        });

        // Salva tutti i dati raccolti in un unico CSV
        await csvWriter.writeRecords(allNews);
        console.log('Dati salvati con successo in "notizie.csv".');

        // Chiudi il browser
        await browser.close();
        
    } catch (error) {
        console.error('Errore durante l’estrazione delle notizie:', error.message);
    }
})();