// src/components/NuevoUsuarioModal.jsx
import React, { useState, useEffect, useContext, useMemo } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import { validarNombre, validarUsuario, validarContrasena } from '../utils/validations';
import { AuthContext } from '../contexts/AuthContext';
import { FiEye, FiEyeOff } from 'react-icons/fi';

const API_BASE =
  import.meta?.env?.VITE_API_BASE ||
  import.meta?.env?.VITE_API_BASE_URL ||
  import.meta?.env?.VITE_API_URL ||
  'http://localhost:3001';

const NuevoUsuarioModal = ({
  show,
  onClose,
  onUsuarioCreado,
  modoEdicion = false,
  usuarioEditar = null,
  idAdmin = null,
}) => {
  const authCtx = useContext(AuthContext);

  const [formData, setFormData] = useState({
    nombre: '',
    correo: '',
    usuario: '',
    contrasena: '',
    estado: '',
    rol: '',
  });

  const [errors, setErrors] = useState({});
  const [estados, setEstados] = useState([]);
  const [roles, setRoles] = useState([]);

  // 👇 Control de ojo y leyenda persistente
  const [showPwd, setShowPwd] = useState(false);
  const [pwdHintShown, setPwdHintShown] = useState(false);

  // === Resolver id_admin
  const adminIdFinal = useMemo(() => {
    if (idAdmin) return Number(idAdmin);
    const ctxId = authCtx?.user?.id ?? authCtx?.user?.ID;
    if (ctxId) return Number(ctxId);
    try {
      const u  = JSON.parse(localStorage.getItem('user') || 'null');
      const ud = JSON.parse(localStorage.getItem('userData') || 'null');
      const au = JSON.parse(localStorage.getItem('auth') || 'null');
      const lsId = u?.id ?? u?.ID ?? ud?.id ?? ud?.ID ?? au?.user?.id ?? au?.user?.ID;
      return lsId ? Number(lsId) : null;
    } catch {
      return null;
    }
  }, [idAdmin, authCtx]);

  useEffect(() => {
    if (!show) return;

    axios.get(`${API_BASE}/api/estados`).then(res => setEstados(res.data || [])).catch(() => setEstados([]));
    axios.get(`${API_BASE}/api/roles`).then(res => setRoles(res.data || [])).catch(() => setRoles([]));

    if (modoEdicion && usuarioEditar) {
      setFormData({
        nombre: usuarioEditar.NOMBRE || '',
        correo: usuarioEditar.CORREO || '',
        usuario: usuarioEditar.USUARIO || '',
        contrasena: '',
        estado: usuarioEditar.ESTADO || '',
        rol: usuarioEditar.ROL_ID || '',
      });
    } else {
      setFormData({ nombre:'', correo:'', usuario:'', contrasena:'', estado:'', rol:'' });
    }

    setErrors({});
    setShowPwd(false);
    setPwdHintShown(false);
  }, [show, modoEdicion, usuarioEditar, adminIdFinal]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    // ✅ Validación “en vivo” para contraseña con leyenda persistente
    if (name === 'contrasena' && !modoEdicion) {
      const ePwd = validarContrasena(value);
      setErrors((prev) => ({ ...prev, contrasena: ePwd || undefined }));
      if (ePwd && !pwdHintShown) setPwdHintShown(true); // se muestra al primer fallo y NO se oculta al vaciar
      // (quitado) if (!value) setPwdHintShown(false);
    }
  };

  const validarFormulario = () => {
    const nuevosErrores = {};

    const eNombre = validarNombre(formData.nombre);
    if (eNombre) nuevosErrores.nombre = eNombre;

    const eUsuario = validarUsuario(formData.usuario);
    if (eUsuario) nuevosErrores.usuario = eUsuario;

    if (!modoEdicion) {
      const ePwd = validarContrasena(formData.contrasena);
      if (ePwd) {
        nuevosErrores.contrasena = ePwd;
        if (!pwdHintShown) setPwdHintShown(true); // asegurar leyenda si el primer fallo es al enviar
      }
    }

    if (!formData.correo) {
      nuevosErrores.correo = 'El correo es obligatorio';
    } else {
      const regexEmail = /^\S+@\S+\.\S+$/;
      if (!regexEmail.test(formData.correo)) {
        nuevosErrores.correo = 'Correo inválido';
      }
    }

    if (!formData.estado) nuevosErrores.estado = 'Seleccione un estado';
    if (!formData.rol) nuevosErrores.rol = 'Seleccione un rol';

    setErrors(nuevosErrores);
    return Object.keys(nuevosErrores).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validarFormulario()) return;

    if (!adminIdFinal) {
      toast.error('No se pudo identificar al administrador que realiza la acción.');
      return;
    }

    try {
      const payload = { ...formData, id_admin: adminIdFinal };

      if (modoEdicion) {
        await axios.put(`${API_BASE}/api/usuarios/${usuarioEditar.ID}`, payload);
        toast.success('Usuario editado correctamente');
      } else {
        await axios.post(`${API_BASE}/api/usuarios`, payload);
        toast.success('Usuario creado correctamente');
      }

      onUsuarioCreado?.();
      onClose?.();
    } catch (error) {
      console.error('Error al guardar usuario:', error);
      const msg =
        error?.response?.data?.message ||
        (String(error?.message || '').includes('409') ? 'Usuario o correo ya existe' : 'Error al guardar usuario. Intente nuevamente.');
      toast.error(msg);
    }
  };

  if (!show) return null;

  return (
    <div className="modal show d-block" tabIndex="-1" role="dialog" aria-modal="true">
      <div className="modal-dialog" role="document">
        <div className="modal-content">
          <form onSubmit={handleSubmit} noValidate>
            <div className="modal-header">
              <h5 className="modal-title">{modoEdicion ? 'Editar Usuario' : 'Agregar Nuevo Usuario'}</h5>
              <button type="button" className="btn-close" onClick={onClose} aria-label="Cerrar" />
            </div>

            <div className="modal-body">
              <div className="mb-3">
                <label className="form-label" htmlFor="nombre">Nombre</label>
                <input
                  type="text"
                  id="nombre"
                  name="nombre"
                  className={`form-control ${errors.nombre ? 'is-invalid' : ''}`}
                  value={formData.nombre}
                  onChange={handleChange}
                />
                {errors.nombre && <div className="invalid-feedback">{errors.nombre}</div>}
              </div>

              <div className="mb-3">
                <label className="form-label" htmlFor="correo">Correo</label>
                <input
                  type="email"
                  id="correo"
                  name="correo"
                  disabled={modoEdicion}
                  className={`form-control ${errors.correo ? 'is-invalid' : ''}`}
                  value={formData.correo}
                  onChange={handleChange}
                />
                {errors.correo && <div className="invalid-feedback">{errors.correo}</div>}
              </div>

              <div className="mb-3">
                <label className="form-label" htmlFor="usuario">Usuario</label>
                <input
                  type="text"
                  id="usuario"
                  name="usuario"
                  className={`form-control ${errors.usuario ? 'is-invalid' : ''}`}
                  value={formData.usuario}
                  onChange={handleChange}
                />
                {errors.usuario && <div className="invalid-feedback">{errors.usuario}</div>}
              </div>

              {/* Contraseña con ojo y leyenda persistente */}
              <div className="mb-3">
                <label className="form-label" htmlFor="contrasena">Contraseña</label>
                <div className="input-group">
                  <input
                    type={showPwd ? 'text' : 'password'}
                    id="contrasena"
                    name="contrasena"
                    disabled={modoEdicion}
                    className={`form-control ${errors.contrasena ? 'is-invalid' : ''}`}
                    value={formData.contrasena}
                    onChange={handleChange}
                    aria-describedby="pwdHelp"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="btn btn-outline-secondary d-flex align-items-center justify-content-center"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setShowPwd((v) => !v)}
                    disabled={modoEdicion}
                    aria-label={showPwd ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    title={showPwd ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    style={{ width: 44 }}
                  >
                    {showPwd ? <FiEyeOff /> : <FiEye />}
                  </button>
                </div>

                {/* Mensaje de error del validador */}
                {errors.contrasena && <div className="invalid-feedback d-block">{errors.contrasena}</div>}

                {/* Leyenda que se mantiene visible hasta que cumpla reglas */}
                {pwdHintShown && !modoEdicion && (
                  <div id="pwdHelp" className="form-text" aria-live="polite">
                    La contraseña debe tener <strong>al menos 10 caracteres</strong>, incluir
                    <strong> una mayúscula</strong>, <strong>una minúscula</strong>, <strong>un número</strong> y
                    <strong> un carácter especial</strong>.
                  </div>
                )}
              </div>

              <div className="mb-3">
                <label className="form-label" htmlFor="estado">Estado</label>
                <select
                  id="estado"
                  name="estado"
                  className={`form-select ${errors.estado ? 'is-invalid' : ''}`}
                  value={formData.estado}
                  onChange={handleChange}
                >
                  <option value="">Seleccione estado</option>
                  {estados.map((e) => (
                    <option key={e.ID} value={e.ID}>{e.NOMBRE}</option>
                  ))}
                </select>
                {errors.estado && <div className="invalid-feedback">{errors.estado}</div>}
              </div>

              <div className="mb-3">
                <label className="form-label" htmlFor="rol">Rol</label>
                <select
                  id="rol"
                  name="rol"
                  className={`form-select ${errors.rol ? 'is-invalid' : ''}`}
                  value={formData.rol}
                  onChange={handleChange}
                >
                  <option value="">Seleccione rol</option>
                  {roles.map((r) => (
                    <option key={r.ID} value={r.ID}>{r.NOMBRE}</option>
                  ))}
                </select>
                {errors.rol && <div className="invalid-feedback">{errors.rol}</div>}
              </div>
            </div>

            <div className="modal-footer">
              <button type="submit" className="btn btn-primary">
                {modoEdicion ? 'Guardar Cambios' : 'Guardar'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cerrar
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default NuevoUsuarioModal;
