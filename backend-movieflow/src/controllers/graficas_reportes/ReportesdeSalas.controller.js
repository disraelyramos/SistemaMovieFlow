// src/controllers/graficas_reportes/ReportesdeSalas.controllers.js
const oracledb = require('oracledb');
const db = require('../../config/db');

const OUT_OBJ = { outFormat: oracledb.OUT_FORMAT_OBJECT };

/* Helpers (filtros consistentes con tus otros reportes) */
const ENTRADAS_OK = `
  (e.estado IN ('EMITIDA','PAGADA','CONFIRMADA') OR e.estado IS NULL)
`;
const COMPRAS_OK = `
  c.estado IN ('PAGADA','CONFIRMADA')
`;

/* ============================
 * 1) KPI RESUMEN (encabezado)
 * ============================ */
exports.getKPIsSalas = async (_req, res) => {
  let cn;
  try {
    cn = await db.getConnection();

    // 1.1 Ocupación promedio últimos 15 días (ponderado por aforo) — usando ENTRADAS + COMPRAS
    const qOcup15 = `
      WITH base AS (
        SELECT f.id_funcion,
               s.capacidad                                     AS aforo,
               COUNT(e.id_entrada)                              AS vendidos
        FROM   funciones f
        JOIN   salas s              ON s.id_sala = f.id_sala AND s.estado = 'ACTIVA'
        JOIN   funcion_asiento fa   ON fa.id_funcion = f.id_funcion
        JOIN   entradas e           ON e.id_fa      = fa.id_fa
        JOIN   compras  c           ON c.id_compra  = e.id_compra
        WHERE  TRUNC(f.fecha) BETWEEN TRUNC(SYSDATE) - 14 AND TRUNC(SYSDATE)
          AND  ${COMPRAS_OK}
          AND  ${ENTRADAS_OK}
        GROUP  BY f.id_funcion, s.capacidad
      )
      SELECT ROUND(100 * (SUM(vendidos) / NULLIF(SUM(aforo),0)), 1) AS pct_ocup_15d
      FROM base`;
    const rOcup15 = await cn.execute(qOcup15, {}, OUT_OBJ);

    // 1.2 Capacidad total (salas activas)
    const qCapTotal = `
      SELECT NVL(SUM(capacidad),0) AS capacidad_total
      FROM salas
      WHERE estado = 'ACTIVA'`;
    const rCapTotal = await cn.execute(qCapTotal, {}, OUT_OBJ);

    // 1.3 Asientos vendidos HOY — ENTRADAS + COMPRAS
    const qVendidosHoy = `
      SELECT COUNT(e.id_entrada) AS ocupados_hoy
      FROM   funciones f
      JOIN   salas s              ON s.id_sala = f.id_sala AND s.estado = 'ACTIVA'
      JOIN   funcion_asiento fa   ON fa.id_funcion = f.id_funcion
      JOIN   entradas e           ON e.id_fa     = fa.id_fa
      JOIN   compras  c           ON c.id_compra = e.id_compra
      WHERE  TRUNC(f.fecha) = TRUNC(SYSDATE)
        AND  ${COMPRAS_OK}
        AND  ${ENTRADAS_OK}`;
    const rVendidosHoy = await cn.execute(qVendidosHoy, {}, OUT_OBJ);

    // 1.4 Salas activas
    const qSalasAct = `
      SELECT COUNT(*) AS salas_activas
      FROM salas
      WHERE estado = 'ACTIVA'`;
    const rSalasAct = await cn.execute(qSalasAct, {}, OUT_OBJ);

    res.json({
      ocupacionPromedio15d: Number(rOcup15.rows?.[0]?.PCT_OCUP_15D ?? 0),
      totalAsientos:        Number(rCapTotal.rows?.[0]?.CAPACIDAD_TOTAL ?? 0),
      asientosOcupadosHoy:  Number(rVendidosHoy.rows?.[0]?.OCUPADOS_HOY ?? 0),
      salasActivas:         Number(rSalasAct.rows?.[0]?.SALAS_ACTIVAS ?? 0),
    });
  } catch (err) {
    console.error('getKPIsSalas error:', err);
    res.status(500).json({ error: 'No se pudo calcular los KPIs' });
  } finally {
    try { await cn?.close(); } catch {}
  }
};


/* =====================================
 * 2) Ocupación por Sala (HOY)
 *    - Capacidad | Vendidos | Reservados
 * ===================================== */
exports.getOcupacionPorSalaHoy = async (_req, res) => {
  let cn;
  try {
    cn = await db.getConnection();

    const q = `
      WITH vendidos AS (
        SELECT s.id_sala, COUNT(e.id_entrada) AS cnt
        FROM   salas s
        JOIN   funciones f        ON f.id_sala = s.id_sala AND TRUNC(f.fecha) = TRUNC(SYSDATE)
        JOIN   funcion_asiento fa ON fa.id_funcion = f.id_funcion
        JOIN   entradas e         ON e.id_fa     = fa.id_fa
        JOIN   compras  c         ON c.id_compra = e.id_compra
        WHERE  s.estado = 'ACTIVA'
          AND  ${COMPRAS_OK}
          AND  ${ENTRADAS_OK}
        GROUP  BY s.id_sala
      ),
      reservados AS (
        SELECT s.id_sala, COUNT(*) AS cnt
        FROM   salas s
        JOIN   funciones f        ON f.id_sala = s.id_sala AND TRUNC(f.fecha) = TRUNC(SYSDATE)
        JOIN   funcion_asiento fa ON fa.id_funcion = f.id_funcion
        WHERE  s.estado = 'ACTIVA'
          AND  UPPER(fa.estado) = 'RESERVADO'
        GROUP  BY s.id_sala
      )
      SELECT
        s.nombre                                   AS sala,
        s.capacidad                                AS capacidad,
        NVL(v.cnt,0)                               AS vendidos,
        NVL(r.cnt,0)                               AS reservados
      FROM salas s
      LEFT JOIN vendidos  v ON v.id_sala = s.id_sala
      LEFT JOIN reservados r ON r.id_sala = s.id_sala
      WHERE s.estado = 'ACTIVA'
      ORDER BY s.nombre`;
    const r = await cn.execute(q, {}, OUT_OBJ);

    res.json(r.rows ?? []);
  } catch (err) {
    console.error('getOcupacionPorSalaHoy error:', err);
    res.status(500).json({ error: 'No se pudo obtener la ocupación por sala' });
  } finally {
    try { await cn?.close(); } catch {}
  }
};


/* ======================================
 * 3) Tendencia Semanal (últimos 7 días)
 * ====================================== */
exports.getTendenciaSemanal = async (_req, res) => {
  let cn;
  try {
    cn = await db.getConnection();

    const q = `
      WITH aforo_dia AS (
        SELECT TRUNC(f.fecha) AS dia, SUM(s.capacidad) AS aforo
        FROM   funciones f
        JOIN   salas s ON s.id_sala = f.id_sala AND s.estado = 'ACTIVA'
        WHERE  TRUNC(f.fecha) BETWEEN TRUNC(SYSDATE) - 6 AND TRUNC(SYSDATE)
        GROUP  BY TRUNC(f.fecha)
      ),
      vendidos_dia AS (
        SELECT TRUNC(f.fecha) AS dia, COUNT(e.id_entrada) AS vendidos
        FROM   funciones f
        JOIN   salas s              ON s.id_sala = f.id_sala AND s.estado = 'ACTIVA'
        JOIN   funcion_asiento fa   ON fa.id_funcion = f.id_funcion
        JOIN   entradas e           ON e.id_fa     = fa.id_fa
        JOIN   compras  c           ON c.id_compra = e.id_compra
        WHERE  TRUNC(f.fecha) BETWEEN TRUNC(SYSDATE) - 6 AND TRUNC(SYSDATE)
          AND  ${COMPRAS_OK}
          AND  ${ENTRADAS_OK}
        GROUP  BY TRUNC(f.fecha)
      )
      SELECT a.dia,
             ROUND(100 * (NVL(v.vendidos,0) / NULLIF(a.aforo,0)), 1) AS pct_ocupacion
      FROM   aforo_dia a
      LEFT   JOIN vendidos_dia v ON v.dia = a.dia
      ORDER  BY a.dia`;
    const r = await cn.execute(q, {}, OUT_OBJ);

    res.json(r.rows ?? []);
  } catch (err) {
    console.error('getTendenciaSemanal error:', err);
    res.status(500).json({ error: 'No se pudo obtener la tendencia semanal' });
  } finally {
    try { await cn?.close(); } catch {}
  }
};


/* =======================================================
 * 4) Detalle de Ocupación por Sala y Día (últ. 7d)
 * ======================================================= */
exports.getDetalleOcupacion = async (_req, res) => {
  let cn;
  try {
    cn = await db.getConnection();

    const q = `
      WITH det AS (
        SELECT
          s.nombre         AS sala,
          TRUNC(f.fecha)   AS dia,
          s.capacidad      AS capacidad,
          LEAST(
            COUNT(e.id_entrada),
            s.capacidad
          ) AS vendidos
        FROM   salas s
        JOIN   funciones f        ON f.id_sala = s.id_sala
        JOIN   funcion_asiento fa ON fa.id_funcion = f.id_funcion
        JOIN   entradas e         ON e.id_fa     = fa.id_fa
        JOIN   compras  c         ON c.id_compra = e.id_compra
        WHERE  s.estado = 'ACTIVA'
          AND  TRUNC(f.fecha) BETWEEN TRUNC(SYSDATE) - 6 AND TRUNC(SYSDATE)
          AND  ${COMPRAS_OK}
          AND  ${ENTRADAS_OK}
        GROUP  BY s.nombre, TRUNC(f.fecha), s.capacidad
      )
      SELECT
        sala,
        TO_CHAR(dia, 'DAY', 'NLS_DATE_LANGUAGE=SPANISH') AS dia_semana,
        capacidad,
        vendidos                                        AS ocupados,
        (capacidad - vendidos)                          AS disponibles,
        ROUND(100 * (vendidos / NULLIF(capacidad,0)),1) AS pct_ocupacion,
        CASE
          WHEN (vendidos / NULLIF(capacidad,0)) >= 0.80 THEN 'Alta'
          WHEN (vendidos / NULLIF(capacidad,0)) >= 0.60 THEN 'Media'
          ELSE 'Baja'
        END AS estado
      FROM det
      ORDER BY sala, dia`;
    const r = await cn.execute(q, {}, OUT_OBJ);

    res.json(r.rows ?? []);
  } catch (err) {
    console.error('getDetalleOcupacion error:', err);
    res.status(500).json({ error: 'No se pudo obtener el detalle de ocupación' });
  } finally {
    try { await cn?.close(); } catch {}
  }
};


/* ==========================================================
 * 5) Ingresos por sala (hoy) — usando ENTRADAS + COMPRAS
 * ========================================================== */
exports.getIngresosPorSalaHoy = async (_req, res) => {
  let cn;
  try {
    cn = await db.getConnection();

    const q = `
      SELECT s.nombre AS sala,
             NVL(SUM(NVL(e.precio, f.precio)),0) AS ingresos_total
      FROM   salas s
      LEFT   JOIN funciones f        ON f.id_sala = s.id_sala AND TRUNC(f.fecha) = TRUNC(SYSDATE)
      LEFT   JOIN funcion_asiento fa ON fa.id_funcion = f.id_funcion
      LEFT   JOIN entradas e         ON e.id_fa     = fa.id_fa
      LEFT   JOIN compras  c         ON c.id_compra = e.id_compra
      WHERE  s.estado = 'ACTIVA'
        AND  (c.id_compra IS NULL OR (${COMPRAS_OK} AND ${ENTRADAS_OK}))
      GROUP  BY s.nombre
      ORDER  BY s.nombre`;
    const r = await cn.execute(q, {}, OUT_OBJ);

    res.json(r.rows ?? []);
  } catch (err) {
    console.error('getIngresosPorSalaHoy error:', err);
    res.status(500).json({ error: 'No se pudo obtener ingresos por sala' });
  } finally {
    try { await cn?.close(); } catch {}
  }
};


/* ==========================================================
 * 6) KPIs por sala específica — mismo criterio
 * ========================================================== */
exports.getKPIsDeSala = async (req, res) => {
  let cn;
  try {
    cn = await db.getConnection();
    const salaId = Number(req.params.salaId || 0);
    if (!Number.isFinite(salaId) || salaId <= 0) {
      return res.status(400).json({ error: 'salaId inválido' });
    }

    // Capacidad y estado de la sala
    const qSala = `
      SELECT capacidad AS capacidad, estado
      FROM salas
      WHERE id_sala = :salaId`;
    const rSala = await cn.execute(qSala, { salaId }, OUT_OBJ);
    const capacidad = Number(rSala.rows?.[0]?.CAPACIDAD ?? 0);
    const estadoSala = rSala.rows?.[0]?.ESTADO ?? null;

    // Promedio 15d — ENTRADAS + COMPRAS
    const qOcup15 = `
      WITH base AS (
        SELECT f.id_funcion,
               :capacidad AS aforo,
               COUNT(e.id_entrada) AS vendidos
        FROM   funciones f
        JOIN   funcion_asiento fa ON fa.id_funcion = f.id_funcion
        JOIN   entradas e         ON e.id_fa     = fa.id_fa
        JOIN   compras  c         ON c.id_compra = e.id_compra
        WHERE  f.id_sala = :salaId
          AND  TRUNC(f.fecha) BETWEEN TRUNC(SYSDATE) - 14 AND TRUNC(SYSDATE)
          AND  ${COMPRAS_OK}
          AND  ${ENTRADAS_OK}
        GROUP  BY f.id_funcion
      )
      SELECT ROUND(100 * (SUM(vendidos) / NULLIF(SUM(aforo),0)), 1) AS pct_ocup_15d
      FROM base`;
    const rOcup15 = await cn.execute(qOcup15, { salaId, capacidad }, OUT_OBJ);

    // Vendidos HOY — ENTRADAS + COMPRAS
    const qVendidosHoy = `
      SELECT NVL(COUNT(e.id_entrada),0) AS ocupados_hoy
      FROM   funciones f
      JOIN   funcion_asiento fa ON fa.id_funcion = f.id_funcion
      JOIN   entradas e         ON e.id_fa     = fa.id_fa
      JOIN   compras  c         ON c.id_compra = e.id_compra
      WHERE  f.id_sala = :salaId
        AND  TRUNC(f.fecha) = TRUNC(SYSDATE)
        AND  ${COMPRAS_OK}
        AND  ${ENTRADAS_OK}`;
    const rVendidosHoy = await cn.execute(qVendidosHoy, { salaId }, OUT_OBJ);

    const salasActivas = (estadoSala === 'ACTIVA') ? 1 : 0;

    return res.json({
      ocupacionPromedio15d: Number(rOcup15.rows?.[0]?.PCT_OCUP_15D ?? 0),
      totalAsientos:        capacidad,
      asientosOcupadosHoy:  Number(rVendidosHoy.rows?.[0]?.OCUPADOS_HOY ?? 0),
      salasActivas
    });
  } catch (err) {
    console.error('getKPIsDeSala error:', err);
    res.status(500).json({ error: 'No se pudo calcular los KPIs de la sala' });
  } finally {
    try { await cn?.close(); } catch {}
  }
};
