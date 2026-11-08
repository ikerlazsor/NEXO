export type Participant = {
  id: string;
  nombre: string;
  avatar_url?: string | null;
  isCreator?: boolean;
  ambientes_preferidos?: string[] | null;
  etiquetas?: string[] | null;
  genero?: string | null;
};

export type PlanRow = {
  id: string;
  titulo: string;
  imagen_url: string | null;
  categoria: string;
  tipo_deporte: string | null;
  fecha_evento: string | null;
  nombre_ubicacion: string | null;
  latitud: number | null;
  longitud: number | null;
  maximo_participantes: number;
  creador_id: string;
  requiere_aprobacion: boolean;
  descripcion: string | null;
  solo_chicas?: boolean;
  modo_privado?: boolean;
  chat_eliminado_en?: string | null;
  imagenes_url?: string[] | null;
  recurrencia?: { freq?: string; paused?: boolean } | null;
  es_organizador?: boolean;
};

export type { PlanDetailSnapshot } from "../../lib/planDetailCache";
