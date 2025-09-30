const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;


// --- INICIO DE LA LÓGICA DE CACHÉ ---
let turnosCache = {
    timestamp: 0,
    data: null
};
const CACHE_DURATION_MS = 2 * 60 * 1000; // 2 minutos
// --- FIN DE LA LÓGICA DE CACHÉ ---


// Endpoint para que el frontend pida los turnos (AHORA CON CACHÉ)
app.get('/api/turnos', async (req, res) => {
    const now = Date.now();
    // Si el caché es reciente, lo devolvemos inmediatamente
    if (now - turnosCache.timestamp < CACHE_DURATION_MS && turnosCache.data) {
        console.log("Sirviendo turnos desde el CACHÉ.");
        return res.json(turnosCache.data);
    }

    // Si el caché es viejo o no existe, pedimos datos nuevos a Google
    try {
        console.log("Caché expirado. Pidiendo nuevos turnos a Google...");
        const response = await axios.post(APPS_SCRIPT_URL, { action: 'getNextAvailable' });
        
        // Guardamos los nuevos datos en el caché
        turnosCache.data = response.data;
        turnosCache.timestamp = Date.now();
        
        res.json(response.data);
    } catch (error) {
        console.error('Error fetching slots from Google:', error);
        res.status(500).json({ status: 'error', message: 'No se pudieron cargar los turnos.' });
    }
});

// Endpoint para reservar un turno
app.post('/api/reservar', async (req, res) => {
    try {
        const { slotId, nombre, apellido, dni, email, whatsapp } = req.body;
        const userInfo = { nombre, apellido, dni, email, whatsapp };

        const response = await axios.post(APPS_SCRIPT_URL, {
            action: 'bookAppointment',
            slotId: slotId,
            userInfo: userInfo
        });

        // IMPORTANTE: Al reservar un turno, invalidamos el caché para que la próxima consulta sea fresca.
        turnosCache.timestamp = 0;

        res.json(response.data);
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Error al reservar el turno.' });
    }
});

// --- INICIO DEL CÓDIGO FALTANTE ---
// Endpoint para que el panel de administración pida TODOS los turnos agendados
app.get('/api/admin/turnos', async (req, res) => {
    try {
        const response = await axios.post(APPS_SCRIPT_URL, { action: 'getAllAppointments' });
        res.json(response.data);
    } catch (error) {
        console.error('Error fetching all appointments:', error);
        res.status(500).json({ status: 'error', message: 'No se pudieron cargar los turnos agendados.' });
    }
});

// Endpoint para que el panel de administración pida todas las derivaciones
app.get('/api/admin/derivaciones', async (req, res) => {
    try {
        const response = await axios.post(APPS_SCRIPT_URL, { action: 'getAllReferrals' });
        res.json(response.data);
    } catch (error) {
        console.error('Error fetching referrals:', error);
        res.status(500).json({ status: 'error', message: 'No se pudieron cargar las derivaciones.' });
    }
});

// Endpoint para buscar datos de un afiliado por DNI
app.get('/api/usuario/:dni', async (req, res) => {
    try {
        const { dni } = req.params;
        const response = await axios.post(APPS_SCRIPT_URL, {
            action: 'getUserDataByDNI',
            dni: dni
        });
        res.json(response.data);
    } catch (error) {
        console.error('Error fetching user data by DNI:', error);
        res.status(500).json({ status: 'error', message: 'No se pudo buscar el afiliado.' });
    }
});

// Endpoint para cancelar un turno
app.post('/api/cancelar', async (req, res) => {
    try {
        const { eventId } = req.body;
        const response = await axios.post(APPS_SCRIPT_URL, {
            action: 'cancelAppointment',
            eventId: eventId
        });

        // IMPORTANTE: Al cancelar, también invalidamos el caché.
        turnosCache.timestamp = 0;

        res.json(response.data);
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Error al cancelar el turno.' });
    }
});

// Endpoint para el registro de nuevos profesionales
app.post('/api/profesionales/registro', async (req, res) => {
    try {
        const response = await axios.post(APPS_SCRIPT_URL, {
            action: 'registerProfessional',
            professionalData: req.body
        });
        res.json(response.data);
    } catch (error) {
        console.error('Error registering professional:', error);
        res.status(500).json({ status: 'error', message: 'No se pudo procesar la solicitud de registro.' });
    }
});

// Endpoint para el login de profesionales
app.post('/api/profesionales/login', async (req, res) => {
    try {
        const response = await axios.post(APPS_SCRIPT_URL, {
            action: 'loginProfessional',
            credentials: req.body
        });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Error en el servidor.' });
    }
});

// Endpoint para guardar una derivación
app.post('/api/profesionales/derivar', async (req, res) => {
    try {
        const response = await axios.post(APPS_SCRIPT_URL, {
            action: 'createReferral',
            referralData: req.body
        });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'No se pudo guardar la derivación.' });
    }
});

// Endpoint para el registro de nuevos preventivistas
app.post('/api/preventivistas/registro', async (req, res) => {
    try {
        const response = await axios.post(APPS_SCRIPT_URL, {
            action: 'registerPreventivista',
            preventivistaData: req.body
        });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'No se pudo procesar el registro.' });
    }
});

// Endpoint para el login de preventivistas
app.post('/api/preventivistas/login', async (req, res) => {
    try {
        const response = await axios.post(APPS_SCRIPT_URL, {
            action: 'loginPreventivista',
            credentials: req.body
        });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Error en el servidor de login.' });
    }
});

// Endpoint para obtener la lista de días bloqueados
app.get('/api/admin/dias-bloqueados', async (req, res) => {
    try {
        const response = await axios.post(APPS_SCRIPT_URL, { action: 'getBlockedDays' });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'No se pudieron cargar los días bloqueados.' });
    }
});

// Endpoint para bloquear un nuevo día
app.post('/api/admin/bloquear-dia', async (req, res) => {
    try {
        const { date } = req.body;
        const response = await axios.post(APPS_SCRIPT_URL, {
            action: 'blockDay',
            date: date
        });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'No se pudo bloquear el día.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor de la turnera corriendo en http://localhost:${PORT}`);
});