const express = require("express");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(express.static("public"));

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

// --- CACHÉ ---
let turnosCache = { timestamp: 0, data: null };
const CACHE_DURATION_MS = 2 * 60 * 1000;

// =========================================================
// TURNOS
// =========================================================

app.get("/api/turnos", async (req, res) => {
  const now = Date.now();
  if (now - turnosCache.timestamp < CACHE_DURATION_MS && turnosCache.data) {
    console.log("Sirviendo turnos desde el CACHÉ.");
    return res.json(turnosCache.data);
  }
  try {
    console.log("Caché expirado. Pidiendo nuevos turnos a Google...");
    const response = await axios.post(APPS_SCRIPT_URL, {
      action: "getNextAvailable",
    });
    turnosCache.data = response.data;
    turnosCache.timestamp = Date.now();
    res.json(response.data);
  } catch (error) {
    res
      .status(500)
      .json({ status: "error", message: "No se pudieron cargar los turnos." });
  }
});

app.post("/api/reservar", async (req, res) => {
  try {
    const { slotId, nombre, apellido, dni, email, whatsapp } = req.body;
    const response = await axios.post(APPS_SCRIPT_URL, {
      action: "bookAppointment",
      slotId: slotId,
      userInfo: { nombre, apellido, dni, email, whatsapp },
    });
    turnosCache.timestamp = 0;
    res.json(response.data);
  } catch (error) {
    res
      .status(500)
      .json({ status: "error", message: "Error al reservar el turno." });
  }
});

app.post("/api/cancelar", async (req, res) => {
  try {
    const { eventId } = req.body;
    const response = await axios.post(APPS_SCRIPT_URL, {
      action: "cancelAppointment",
      eventId: eventId,
    });
    turnosCache.timestamp = 0;
    res.json(response.data);
  } catch (error) {
    res
      .status(500)
      .json({ status: "error", message: "Error al cancelar el turno." });
  }
});

app.get("/api/admin/turnos", async (req, res) => {
  try {
    const response = await axios.post(APPS_SCRIPT_URL, {
      action: "getAllAppointments",
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "No se pudieron cargar los turnos agendados.",
    });
  }
});

app.get("/api/usuario/:dni", async (req, res) => {
  try {
    const { dni } = req.params;
    const response = await axios.post(APPS_SCRIPT_URL, {
      action: "getUserDataByDNI",
      dni: dni,
    });
    res.json(response.data);
  } catch (error) {
    res
      .status(500)
      .json({ status: "error", message: "No se pudo buscar el afiliado." });
  }
});

// =========================================================
// PROFESIONALES — escribe en Supabase Y Google Sheets
// =========================================================
app.post("/api/profesionales/registro", async (req, res) => {
  try {
    console.log("BODY recibido:", JSON.stringify(req.body));
    const response = await axios.post(
      APPS_SCRIPT_URL,
      {
        action: "registerProfessional",
        professionalData: req.body,
      },
      { timeout: 30000 },
    );

    console.log("RESPONSE Apps Script:", JSON.stringify(response.data));
    if (response.data.status === "success") {
      const {
        dni,
        nombre,
        apellido,
        especialidad,
        matricula,
        telefono,
        email,
      } = req.body;
      const { error } = await supabase.from("profesionales").upsert(
        {
          dni,
          nombre,
          apellido,
          especialidad,
          matricula,
          telefono,
          email,
          usuario: email,
          password: `IAPOS${matricula}`,
        },
        { onConflict: "dni" },
      );

      if (error) console.error("ERROR SUPABASE:", JSON.stringify(error));
      else console.log("✅ Profesional guardado en Supabase:", dni);
    }

    res.json(response.data);
  } catch (error) {
    console.error("ERROR COMPLETO:", error.message);
    res.status(500).json({
      status: "error",
      message: "No se pudo procesar la solicitud de registro.",
    });
  }
});

app.post("/api/profesionales/login", async (req, res) => {
  try {
    const response = await axios.post(APPS_SCRIPT_URL, {
      action: "loginProfessional",
      credentials: req.body,
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ status: "error", message: "Error en el servidor." });
  }
});

// =========================================================
// DERIVACIONES — escribe en Supabase Y Google Sheets
// =========================================================
app.post("/api/profesionales/derivar", async (req, res) => {
  try {
    const response = await axios.post(APPS_SCRIPT_URL, {
      action: "createReferral",
      referralData: req.body,
    });

    if (response.data.status === "success") {
      const {
        dni,
        nombre,
        apellido,
        fechaNacimiento,
        telefono,
        email,
        observaciones,
        medicoDerivador,
      } = req.body;
      const { error } = await supabase.from("derivaciones").insert({
        fecha_derivacion: new Date().toISOString().split("T")[0],
        dni,
        nombre,
        apellido,
        fecha_nacimiento: fechaNacimiento,
        telefono,
        email,
        observaciones,
        profesional: medicoDerivador,
      });

      if (error)
        console.error("ERROR SUPABASE derivaciones:", JSON.stringify(error));
      else console.log("✅ Derivación guardada en Supabase:", dni);
    }

    res.json(response.data);
  } catch (error) {
    res
      .status(500)
      .json({ status: "error", message: "No se pudo guardar la derivación." });
  }
});

// =========================================================
// PREVENTIVISTAS
// =========================================================

app.post("/api/preventivistas/login", async (req, res) => {
  try {
    const response = await axios.post(APPS_SCRIPT_URL, {
      action: "loginPreventivista",
      credentials: req.body,
    });
    res.json(response.data);
  } catch (error) {
    res
      .status(500)
      .json({ status: "error", message: "Error en el servidor de login." });
  }
});

// =========================================================
// DÍAS BLOQUEADOS
// =========================================================

app.get("/api/admin/dias-bloqueados", async (req, res) => {
  try {
    const response = await axios.post(APPS_SCRIPT_URL, {
      action: "getBlockedDays",
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "No se pudieron cargar los días bloqueados.",
    });
  }
});

app.post("/api/admin/bloquear-dia", async (req, res) => {
  try {
    const { date } = req.body;
    const response = await axios.post(APPS_SCRIPT_URL, {
      action: "blockDay",
      date: date,
    });
    res.json(response.data);
  } catch (error) {
    res
      .status(500)
      .json({ status: "error", message: "No se pudo bloquear el día." });
  }
});

const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET;

// =========================================================
// PORTAL PROFESIONAL — JWT
// =========================================================
function verificarToken(req, res, next) {
    const auth = req.headers.authorization;
    console.log('Auth header:', auth ? auth.substring(0,30) : 'NULL');
    console.log('JWT_SECRET:', process.env.JWT_SECRET ? 'OK' : 'FALTA');
    if (!auth) return res.status(401).json({ success: false, message: 'Sin token' });
    try {
        const token = auth.replace('Bearer ', '');
        req.usuario = jwt.verify(token, JWT_SECRET);
        next();
    } catch(e) {
        console.log('Error JWT:', e.message);
        res.status(401).json({ success: false, message: 'Token inválido' });
    }
}

// Agenda cierre DP del médico
app.get("/api/mi-agenda-cierre", verificarToken, async (req, res) => {
  const { fecha } = req.query;
  const idSede = req.usuario.id_sede_dp;
  try {
    let query = supabase
      .from("agenda_cierre_dp")
      .select("*")
      .eq("id_sede_dp", idSede)
      .order("hora", { ascending: true });
    if (fecha) query = query.eq("fecha", fecha);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ success: true, turnos: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Actualizar estado turno cierre
app.get("/api/mi-agenda-cierre", verificarToken, async (req, res) => {
  const { fecha } = req.query;
  const idProfesional = req.usuario.id;
  try {
    // Buscar el médico en medicos_cierre_dp por id_profesional
    const { data: medico } = await supabase
      .from("medicos_cierre_dp")
      .select("id")
      .eq("id_profesional", idProfesional)
      .eq("activo", true)
      .single();

    if (!medico) {
      return res.json({
        success: true,
        turnos: [],
        mensaje: "Sin agenda configurada",
      });
    }

    let query = supabase
      .from("agenda_cierre_dp")
      .select("*")
      .eq("id_medico", medico.id)
      .order("hora", { ascending: true });

    if (fecha) query = query.eq("fecha", fecha);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ success: true, turnos: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// =========================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor de la turnera corriendo en http://localhost:${PORT}`);
});
