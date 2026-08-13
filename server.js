const express = require("express");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();
app.use(express.json());

// ── CORS: permite cualquier subdominio de diapreventivoiapos.com ──
const ORIGENES_PERMITIDOS_REGEX = [
  /^https:\/\/([a-z0-9-]+\.)?diapreventivoiapos\.com$/,
];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ORIGENES_PERMITIDOS_REGEX.some((re) => re.test(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PATCH, DELETE, OPTIONS",
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

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
app.post("/api/profesionales/derivar", async (req, res) => {
  console.log("BODY derivar:", JSON.stringify(req.body));
  try {
    const response = await axios.post(APPS_SCRIPT_URL, {
      action: "createReferral",
      referralData: req.body,
    });
    console.log("Apps Script response:", JSON.stringify(response.data));

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
        id_profesional,
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
        id_profesional: id_profesional || null,
        estado: "PENDIENTE",
      });
      if (error)
        console.error("ERROR SUPABASE derivaciones:", JSON.stringify(error));
      else console.log("✅ Derivación guardada en Supabase:", dni);
    }

    res.json(response.data);
  } catch (error) {
    console.error("ERROR DERIVAR:", error.message);
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
  console.log("Auth header:", auth ? auth.substring(0, 30) : "NULL");
  console.log("JWT_SECRET:", process.env.JWT_SECRET ? "OK" : "FALTA");
  if (!auth)
    return res.status(401).json({ success: false, message: "Sin token" });
  try {
    const token = auth.replace("Bearer ", "");
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    console.log("Error JWT:", e.message);
    res.status(401).json({ success: false, message: "Token inválido" });
  }
}
app.get("/api/mi-agenda-cierre", async (req, res) => {
  const { fecha, id_medico } = req.query;
  try {
    let query = supabase
      .from("agenda_cierre_dp")
      .select("*")
      .order("hora", { ascending: true });
    if (fecha) query = query.eq("fecha", fecha);
    if (id_medico) query = query.eq("id_medico", id_medico);
    const { data, error } = await query;
    if (error) throw error;

    const turnos = data || [];
    const dnis = [...new Set(turnos.map((t) => t.dni).filter(Boolean))];

    // Agregar teléfono/email de cada afiliado — prioridad al contacto
    // editable (contactos_afiliados), con respaldo en la hoja de vida.
    let contactos = {};
    if (dnis.length > 0) {
      const { data: contactosGuardados } = await supabase
        .from("contactos_afiliados")
        .select("dni, telefono, email")
        .in("dni", dnis);
      (contactosGuardados || []).forEach((c) => {
        contactos[c.dni] = c;
      });

      const dnisSinContacto = dnis.filter((d) => !contactos[d]);
      if (dnisSinContacto.length > 0) {
        const { data: afiliadosRespaldo } = await supabase
          .from("afiliados")
          .select("dni, telefono, email")
          .in("dni", dnisSinContacto);
        (afiliadosRespaldo || []).forEach((a) => {
          if (!contactos[a.dni]) contactos[a.dni] = a;
        });
      }
    }

    const turnosConContacto = turnos.map((t) => ({
      ...t,
      telefono: contactos[t.dni]?.telefono || null,
      email: contactos[t.dni]?.email || null,
    }));

    res.json({ success: true, turnos: turnosConContacto });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.patch("/api/mi-agenda-cierre/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("agenda_cierre_dp")
      .update(req.body)
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get("/api/mi-medico", async (req, res) => {
  const { id_profesional } = req.query;
  try {
    const { data } = await supabase
      .from("medicos_cierre_dp")
      .select("id")
      .eq("id_profesional", id_profesional)
      .eq("activo", true)
      .single();
    res.json({ id_medico: data?.id || null });
  } catch (e) {
    res.json({ id_medico: null });
  }
});

app.get("/api/mis-derivaciones", async (req, res) => {
  const { id_profesional } = req.query;
  try {
    const { data, error } = await supabase
      .from("derivaciones")
      .select("*")
      .eq("id_profesional", id_profesional)
      .order("fecha_derivacion", { ascending: false });
    if (error) throw error;
    res.json({ derivaciones: data || [] });
  } catch (e) {
    res.status(500).json({ derivaciones: [] });
  }
});

// ── TELERECETA (aviso, no ocupa turno) ──
app.get("/api/mis-telerecetas", async (req, res) => {
  const { id_medico } = req.query;
  if (!id_medico) {
    return res.status(400).json({ success: false, message: "Falta id_medico." });
  }
  try {
    const { data: avisos, error } = await supabase
      .from("avisos_telereceta")
      .select("*")
      .eq("id_medico", id_medico)
      .eq("estado", "PENDIENTE")
      .order("fecha_creado", { ascending: true });
    if (error) throw error;

    const dnis = [...new Set((avisos || []).map((a) => a.dni))];
    let contactos = {};
    if (dnis.length > 0) {
      const { data: contactosGuardados } = await supabase
        .from("contactos_afiliados")
        .select("dni, telefono, email")
        .in("dni", dnis);
      (contactosGuardados || []).forEach((c) => (contactos[c.dni] = c));

      const sinContacto = dnis.filter((d) => !contactos[d]);
      if (sinContacto.length > 0) {
        const { data: afiliadosRespaldo } = await supabase
          .from("afiliados")
          .select("dni, telefono, email")
          .in("dni", sinContacto);
        (afiliadosRespaldo || []).forEach((a) => {
          if (!contactos[a.dni]) contactos[a.dni] = a;
        });
      }
    }

    const avisosConContacto = (avisos || []).map((a) => ({
      ...a,
      telefono: contactos[a.dni]?.telefono || null,
      email: contactos[a.dni]?.email || null,
    }));

    res.json({ success: true, avisos: avisosConContacto });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post("/api/telereceta/crear", async (req, res) => {
  const { dni, apellido_y_nombre, id_medico, observaciones, creado_por } = req.body;
  if (!dni || !id_medico) {
    return res.status(400).json({ success: false, message: "Faltan datos obligatorios." });
  }
  try {
    const { error } = await supabase.from("avisos_telereceta").insert({
      dni,
      apellido_y_nombre,
      id_medico,
      observaciones: observaciones || null,
      creado_por,
    });
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.patch("/api/telereceta/:id/completar", async (req, res) => {
  try {
    const { data: aviso, error: errorAviso } = await supabase
      .from("avisos_telereceta")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (errorAviso || !aviso) throw errorAviso || new Error("Aviso no encontrado.");

    const { error } = await supabase
      .from("avisos_telereceta")
      .update({ estado: "REALIZADA", fecha_realizada: new Date().toISOString() })
      .eq("id", req.params.id);
    if (error) throw error;

    // Disparar facturación (339150R) al prestador de Coordinación DP de la
    // sede del médico — mismo patrón que Módulo DP/Extramódulo/Seguimiento.
    try {
      const { data: medico } = await supabase
        .from("medicos_cierre_dp")
        .select("id_sede_dp")
        .eq("id", aviso.id_medico)
        .maybeSingle();

      const idSedeDp = medico?.id_sede_dp ? parseInt(medico.id_sede_dp) : null;

      if (idSedeDp) {
        const { data: prestadoresCoordSede } = await supabase
          .from("prestador_sedes")
          .select("id_prestador")
          .eq("id_sede_dp", idSedeDp);

        let prestadorCoord = null;
        if (prestadoresCoordSede && prestadoresCoordSede.length > 0) {
          const idsPrestadores = prestadoresCoordSede.map((r) => r.id_prestador);
          const { data: institucionCoord } = await supabase
            .from("prestadores_institucionales")
            .select("id, nombre_institucion")
            .in("id", idsPrestadores)
            .eq("especialidad", "coordinacion_dp")
            .maybeSingle();
          if (institucionCoord) prestadorCoord = institucionCoord;
        }

        if (prestadorCoord) {
          const hoy = new Date().toISOString().split("T")[0];
          await supabase.from("practicas_autorizadas").insert({
            dni: aviso.dni,
            nombre_completo: aviso.apellido_y_nombre || "",
            descripcion_practica: "Telereceta",
            estado: "REALIZADA",
            fecha_autorizacion: hoy,
            fecha_carga: hoy,
            id_prestador: prestadorCoord.id,
            nombre_prestador: prestadorCoord.nombre_institucion,
          });
          console.log("✅ Telereceta (339150R) registrada para DNI:", aviso.dni);
        } else {
          console.warn(`No hay prestador de Coordinación DP configurado para sede ${idSedeDp}`);
        }
      } else {
        console.warn("No se encontró id_sede_dp del médico para facturar la telereceta.");
      }
    } catch (facturacionErr) {
      console.error("Error al registrar facturación de Telereceta:", facturacionErr.message);
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// =========================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor de la turnera corriendo en http://localhost:${PORT}`);
});