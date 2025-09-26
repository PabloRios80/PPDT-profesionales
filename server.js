const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

// Endpoint para que el frontend pida los turnos disponibles
app.get('/api/turnos', async (req, res) => {
    try {
        const response = await axios.post(APPS_SCRIPT_URL, { action: 'getNextAvailable' });
        res.json(response.data);
    } catch (error) {
        console.error('Error fetching available slots:', error);
        res.status(500).json({ status: 'error', message: 'No se pudieron cargar los turnos.' });
    }
});

// Endpoint para que el frontend reserve un turno
app.post('/api/reservar', async (req, res) => {
    try {
        const { slotId, nombre, apellido, dni, email, whatsapp } = req.body;
        const userInfo = { nombre, apellido, dni, email, whatsapp };

        const response = await axios.post(APPS_SCRIPT_URL, {
            action: 'bookAppointment',
            slotId: slotId,
            userInfo: userInfo
        });
        res.json(response.data);
    } catch (error) {
        console.error('Error booking appointment:', error);
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

// Endpoint para cancelar un turno desde el panel de administración
app.post('/api/cancelar', async (req, res) => {
    try {
        const { eventId } = req.body;
        const response = await axios.post(APPS_SCRIPT_URL, {
            action: 'cancelAppointment',
            eventId: eventId
        });
        res.json(response.data);
    } catch (error) {
        console.error('Error cancelling appointment:', error);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor de la turnera corriendo en http://localhost:${PORT}`);
});