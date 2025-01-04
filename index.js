const puppeteer = require('puppeteer');
const sanitizeHtml = require('sanitize-html');
const { createObjectCsvWriter } = require('csv-writer');

(async () => {
    try {
        // Array per raccogliere tutti i risultati
        const allNews = [];
        
        // Avvia il browser
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();

        await cdsScaper(page, allNews);
        await repubblicaScraper(page, allNews);
        await liberoScraper(page, allNews);

        // Configurazione di csv-writer
        const csvWriter = createObjectCsvWriter({
            path: 'notizie.csv', // Nome del file di output
            header: [
                { id: 'id', title: '*ID_' },
                { id: 'journal', title: '*TIPOQ_' },
                { id: 'event', title: '*CASO_' },
                { id: 'date', title: '*DATA_' },
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

// Funzione per aggiungere un timeout
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const cdsScaper = async (page, allNews) => {
    for (let i = 1; i < 5; i++) {
        // Definisco l'URL per la fonte di notizie
        const url = 'https://www.corriere.it/ricerca/?q=giulia+cecchettin&page=' + i;

        // Vai alla pagina specificata
        await page.goto(url, { waitUntil: 'networkidle2' });

        // Aspetta che il contenuto delle notizie sia visibile
        await page.waitForSelector('.paginationResult');

        // Estrai i titoli e i link delle notizie
        const news = await page.$$eval('.bck-media-news-signature', cards =>
            cards.map(card => {
                const id = 1;
                const journal = 'cds';
                const event = 'cecchettin';
                const date = 'dic2023';
                const titleElement = card.querySelector('h3 a');
                const title = titleElement ? titleElement.textContent.trim() : '';
                const link = titleElement ? titleElement.href : '';
                const text = 'TESTO';
                return { id, journal, event, date, title, text, link };
            })
        );

        const sanitizedNews = news.map(item => ({
            ...item,
            title: sanitizeHtml(item.title),
            text: sanitizeHtml(item.text),
        }));

        // Aggiungi i dati raccolti all'array globale
        allNews.push(...sanitizedNews);

        console.log(`Pagina ${i} processata con successo.`);
        await sleep(5000); // Pausa tra le pagine
    }
};

const repubblicaScraper = async (page, allNews) => {

}

const liberoScraper = async (page, allNews) => {

}
