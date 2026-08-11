// Generated from Supabase project nixeproyzxvqzyrvsxcx on 2026-08-11.
// Regenerate after every schema migration; do not edit manually.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_search_usage: {
        Row: {
          request_count: number
          updated_at: string
          user_id: string
          window_started_at: string
        }
        Insert: {
          request_count?: number
          updated_at?: string
          user_id: string
          window_started_at?: string
        }
        Update: {
          request_count?: number
          updated_at?: string
          user_id?: string
          window_started_at?: string
        }
        Relationships: []
      }
      amistades: {
        Row: {
          actualizado_en: string
          creado_en: string
          estado: Database["public"]["Enums"]["tipo_estado_amistad"]
          id: string
          usuario_destino_id: string
          usuario_origen_id: string
        }
        Insert: {
          actualizado_en?: string
          creado_en?: string
          estado?: Database["public"]["Enums"]["tipo_estado_amistad"]
          id?: string
          usuario_destino_id: string
          usuario_origen_id: string
        }
        Update: {
          actualizado_en?: string
          creado_en?: string
          estado?: Database["public"]["Enums"]["tipo_estado_amistad"]
          id?: string
          usuario_destino_id?: string
          usuario_origen_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "amistades_destino_fkey"
            columns: ["usuario_destino_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amistades_origen_fkey"
            columns: ["usuario_origen_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_events: {
        Row: {
          created_at: string
          event_name: string
          id: string
          props: Json
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_name: string
          id?: string
          props?: Json
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_name?: string
          id?: string
          props?: Json
          user_id?: string | null
        }
        Relationships: []
      }
      bloqueos: {
        Row: {
          bloqueado_id: string
          bloqueador_id: string
          creado_en: string
          id: string
        }
        Insert: {
          bloqueado_id: string
          bloqueador_id: string
          creado_en?: string
          id?: string
        }
        Update: {
          bloqueado_id?: string
          bloqueador_id?: string
          creado_en?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bloqueos_bloqueado_fk"
            columns: ["bloqueado_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bloqueos_bloqueador_fk"
            columns: ["bloqueador_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chats_directos_ocultos: {
        Row: {
          oculto_en: string
          peer_id: string
          usuario_id: string
        }
        Insert: {
          oculto_en?: string
          peer_id: string
          usuario_id: string
        }
        Update: {
          oculto_en?: string
          peer_id?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chats_directos_ocultos_peer_id_fkey"
            columns: ["peer_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chats_directos_ocultos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      estadisticas_usuario: {
        Row: {
          actualizado_en: string
          aspecto_negativo_mas_votado: string | null
          aspecto_positivo_mas_votado: string | null
          categorias_probadas: number
          creado_en: string
          id: string
          numero_amistades: number
          numero_asistencias_confirmadas: number
          numero_evaluadores_distintos: number | null
          numero_planes_realizados: number
          numero_reportes: number
          numero_valoraciones: number
          personas_distintas: number
          planes_creados: number
          planes_deporte: number
          planes_estudio: number
          planes_fiesta: number
          planes_solo_chicas: number
          planes_tapas: number
          porcentaje_asistencia: number | null
          porcentaje_repetiria: number
          usuario_id: string
          valoracion_media: number
          votos_aspecto_negativo: number
          votos_aspecto_positivo: number
        }
        Insert: {
          actualizado_en?: string
          aspecto_negativo_mas_votado?: string | null
          aspecto_positivo_mas_votado?: string | null
          categorias_probadas?: number
          creado_en?: string
          id?: string
          numero_amistades?: number
          numero_asistencias_confirmadas?: number
          numero_evaluadores_distintos?: number | null
          numero_planes_realizados?: number
          numero_reportes?: number
          numero_valoraciones?: number
          personas_distintas?: number
          planes_creados?: number
          planes_deporte?: number
          planes_estudio?: number
          planes_fiesta?: number
          planes_solo_chicas?: number
          planes_tapas?: number
          porcentaje_asistencia?: number | null
          porcentaje_repetiria?: number
          usuario_id: string
          valoracion_media?: number
          votos_aspecto_negativo?: number
          votos_aspecto_positivo?: number
        }
        Update: {
          actualizado_en?: string
          aspecto_negativo_mas_votado?: string | null
          aspecto_positivo_mas_votado?: string | null
          categorias_probadas?: number
          creado_en?: string
          id?: string
          numero_amistades?: number
          numero_asistencias_confirmadas?: number
          numero_evaluadores_distintos?: number | null
          numero_planes_realizados?: number
          numero_reportes?: number
          numero_valoraciones?: number
          personas_distintas?: number
          planes_creados?: number
          planes_deporte?: number
          planes_estudio?: number
          planes_fiesta?: number
          planes_solo_chicas?: number
          planes_tapas?: number
          porcentaje_asistencia?: number | null
          porcentaje_repetiria?: number
          usuario_id?: string
          valoracion_media?: number
          votos_aspecto_negativo?: number
          votos_aspecto_positivo?: number
        }
        Relationships: [
          {
            foreignKeyName: "estadisticas_usuario_fk"
            columns: ["usuario_id"]
            isOneToOne: true
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      expulsiones_plan: {
        Row: {
          creado_en: string
          expulsado_por: string
          id: string
          plan_id: string
          usuario_id: string
        }
        Insert: {
          creado_en?: string
          expulsado_por: string
          id?: string
          plan_id: string
          usuario_id: string
        }
        Update: {
          creado_en?: string
          expulsado_por?: string
          id?: string
          plan_id?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expulsiones_plan_expulsado_por_fkey"
            columns: ["expulsado_por"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expulsiones_plan_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "planes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expulsiones_plan_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      historial_planes: {
        Row: {
          creado_en: string | null
          id: string
          plan_id: string
          usuario_id: string
        }
        Insert: {
          creado_en?: string | null
          id?: string
          plan_id: string
          usuario_id: string
        }
        Update: {
          creado_en?: string | null
          id?: string
          plan_id?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "historial_planes_plan_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "planes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historial_planes_usuario_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invitaciones_planes: {
        Row: {
          creado_en: string
          estado: Database["public"]["Enums"]["tipo_estado_amistad"]
          id: string
          invitado_id: string
          invitador_id: string
          plan_id: string
          tipo: string
        }
        Insert: {
          creado_en?: string
          estado?: Database["public"]["Enums"]["tipo_estado_amistad"]
          id?: string
          invitado_id: string
          invitador_id: string
          plan_id: string
          tipo?: string
        }
        Update: {
          creado_en?: string
          estado?: Database["public"]["Enums"]["tipo_estado_amistad"]
          id?: string
          invitado_id?: string
          invitador_id?: string
          plan_id?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "inv_planes_invitado_fkey"
            columns: ["invitado_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inv_planes_invitador_fkey"
            columns: ["invitador_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inv_planes_plan_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "planes"
            referencedColumns: ["id"]
          },
        ]
      }
      mensaje_reacciones: {
        Row: {
          creado_en: string
          emoji: string
          id: string
          mensaje_id: string
          usuario_id: string
        }
        Insert: {
          creado_en?: string
          emoji: string
          id?: string
          mensaje_id: string
          usuario_id: string
        }
        Update: {
          creado_en?: string
          emoji?: string
          id?: string
          mensaje_id?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mensaje_reacciones_mensaje_id_fkey"
            columns: ["mensaje_id"]
            isOneToOne: false
            referencedRelation: "mensajes"
            referencedColumns: ["id"]
          },
        ]
      }
      mensajes: {
        Row: {
          archivo_url: string | null
          contenido: string
          creado_en: string
          emisor_id: string
          id: string
          plan_id: string | null
          receptor_id: string | null
          tipo: Database["public"]["Enums"]["tipo_mensaje"]
        }
        Insert: {
          archivo_url?: string | null
          contenido: string
          creado_en?: string
          emisor_id: string
          id?: string
          plan_id?: string | null
          receptor_id?: string | null
          tipo?: Database["public"]["Enums"]["tipo_mensaje"]
        }
        Update: {
          archivo_url?: string | null
          contenido?: string
          creado_en?: string
          emisor_id?: string
          id?: string
          plan_id?: string | null
          receptor_id?: string | null
          tipo?: Database["public"]["Enums"]["tipo_mensaje"]
        }
        Relationships: [
          {
            foreignKeyName: "mensajes_emisor_fkey"
            columns: ["emisor_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensajes_plan_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "planes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensajes_receptor_fkey"
            columns: ["receptor_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mensajes_soporte: {
        Row: {
          actualizado_en: string
          asunto: string | null
          creado_en: string
          estado: string
          id: string
          mensaje: string
          notas_internas: string | null
          revisado_en: string | null
          revisado_por: string | null
          tipo: string
          usuario_id: string
        }
        Insert: {
          actualizado_en?: string
          asunto?: string | null
          creado_en?: string
          estado?: string
          id?: string
          mensaje: string
          notas_internas?: string | null
          revisado_en?: string | null
          revisado_por?: string | null
          tipo: string
          usuario_id: string
        }
        Update: {
          actualizado_en?: string
          asunto?: string | null
          creado_en?: string
          estado?: string
          id?: string
          mensaje?: string
          notas_internas?: string | null
          revisado_en?: string | null
          revisado_por?: string | null
          tipo?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mensajes_soporte_revisado_por_fkey"
            columns: ["revisado_por"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensajes_soporte_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      participantes: {
        Row: {
          actualizado_en: string
          creado_en: string
          created_at: string
          estado: Database["public"]["Enums"]["tipo_estado_participante"]
          id: string
          plan_id: string
          usuario_id: string
        }
        Insert: {
          actualizado_en?: string
          creado_en?: string
          created_at?: string
          estado?: Database["public"]["Enums"]["tipo_estado_participante"]
          id?: string
          plan_id: string
          usuario_id: string
        }
        Update: {
          actualizado_en?: string
          creado_en?: string
          created_at?: string
          estado?: Database["public"]["Enums"]["tipo_estado_participante"]
          id?: string
          plan_id?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "participantes_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "planes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participantes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      perfiles: {
        Row: {
          actualizado_en: string
          ambientes_preferidos: string[] | null
          avatar_url: string | null
          baneado: boolean
          baneado_en: string | null
          baneado_motivo: string | null
          creado_en: string
          descripcion: string | null
          etiquetas: string[] | null
          fecha_nacimiento: string | null
          genero: Database["public"]["Enums"]["tipo_genero"] | null
          habitos_consumo: Json | null
          id: string
          nombre: string | null
          nombre_usuario: string | null
          nombre_usuario_cambiado_en: string | null
          nombre_usuario_cambios: string[] | null
          notif_messages: boolean
          notif_reminders: boolean
          notif_social: boolean
          notificaciones_push: boolean
          perfil_gustos: Json | null
          registro_completado: boolean
          rol: string
        }
        Insert: {
          actualizado_en?: string
          ambientes_preferidos?: string[] | null
          avatar_url?: string | null
          baneado?: boolean
          baneado_en?: string | null
          baneado_motivo?: string | null
          creado_en?: string
          descripcion?: string | null
          etiquetas?: string[] | null
          fecha_nacimiento?: string | null
          genero?: Database["public"]["Enums"]["tipo_genero"] | null
          habitos_consumo?: Json | null
          id: string
          nombre?: string | null
          nombre_usuario?: string | null
          nombre_usuario_cambiado_en?: string | null
          nombre_usuario_cambios?: string[] | null
          notif_messages?: boolean
          notif_reminders?: boolean
          notif_social?: boolean
          notificaciones_push?: boolean
          perfil_gustos?: Json | null
          registro_completado?: boolean
          rol?: string
        }
        Update: {
          actualizado_en?: string
          ambientes_preferidos?: string[] | null
          avatar_url?: string | null
          baneado?: boolean
          baneado_en?: string | null
          baneado_motivo?: string | null
          creado_en?: string
          descripcion?: string | null
          etiquetas?: string[] | null
          fecha_nacimiento?: string | null
          genero?: Database["public"]["Enums"]["tipo_genero"] | null
          habitos_consumo?: Json | null
          id?: string
          nombre?: string | null
          nombre_usuario?: string | null
          nombre_usuario_cambiado_en?: string | null
          nombre_usuario_cambios?: string[] | null
          notif_messages?: boolean
          notif_reminders?: boolean
          notif_social?: boolean
          notificaciones_push?: boolean
          perfil_gustos?: Json | null
          registro_completado?: boolean
          rol?: string
        }
        Relationships: []
      }
      plan_invitaciones: {
        Row: {
          created_at: string
          estado: string
          id: string
          invitado_id: string
          invitador_id: string
          plan_id: string
          tipo: string
        }
        Insert: {
          created_at?: string
          estado?: string
          id?: string
          invitado_id: string
          invitador_id: string
          plan_id: string
          tipo?: string
        }
        Update: {
          created_at?: string
          estado?: string
          id?: string
          invitado_id?: string
          invitador_id?: string
          plan_id?: string
          tipo?: string
        }
        Relationships: []
      }
      planes: {
        Row: {
          actualizado_en: string
          categoria: string
          chat_eliminado_en: string | null
          creado_en: string
          creador_id: string
          descripcion: string | null
          estado: Database["public"]["Enums"]["tipo_estado_plan"]
          fecha_evento: string
          finalizado_en: string | null
          id: string
          imagen_url: string | null
          is_direct_chat: boolean | null
          is_group_chat: boolean | null
          latitud: number | null
          longitud: number | null
          maximo_participantes: number
          minimo_participantes: number
          modo_privado: boolean
          nombre_ubicacion: string | null
          requiere_aprobacion: boolean
          solo_amigos: boolean
          solo_chicas: boolean
          tipo_deporte: string | null
          titulo: string
        }
        Insert: {
          actualizado_en?: string
          categoria: string
          chat_eliminado_en?: string | null
          creado_en?: string
          creador_id: string
          descripcion?: string | null
          estado?: Database["public"]["Enums"]["tipo_estado_plan"]
          fecha_evento: string
          finalizado_en?: string | null
          id?: string
          imagen_url?: string | null
          is_direct_chat?: boolean | null
          is_group_chat?: boolean | null
          latitud?: number | null
          longitud?: number | null
          maximo_participantes: number
          minimo_participantes?: number
          modo_privado?: boolean
          nombre_ubicacion?: string | null
          requiere_aprobacion?: boolean
          solo_amigos?: boolean
          solo_chicas?: boolean
          tipo_deporte?: string | null
          titulo: string
        }
        Update: {
          actualizado_en?: string
          categoria?: string
          chat_eliminado_en?: string | null
          creado_en?: string
          creador_id?: string
          descripcion?: string | null
          estado?: Database["public"]["Enums"]["tipo_estado_plan"]
          fecha_evento?: string
          finalizado_en?: string | null
          id?: string
          imagen_url?: string | null
          is_direct_chat?: boolean | null
          is_group_chat?: boolean | null
          latitud?: number | null
          longitud?: number | null
          maximo_participantes?: number
          minimo_participantes?: number
          modo_privado?: boolean
          nombre_ubicacion?: string | null
          requiere_aprobacion?: boolean
          solo_amigos?: boolean
          solo_chicas?: boolean
          tipo_deporte?: string | null
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "planes_creador_id_fkey"
            columns: ["creador_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      planes_guardados: {
        Row: {
          creado_en: string
          id: string
          plan_id: string
          usuario_id: string
        }
        Insert: {
          creado_en?: string
          id?: string
          plan_id: string
          usuario_id: string
        }
        Update: {
          creado_en?: string
          id?: string
          plan_id?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "planes_guardados_plan_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "planes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planes_guardados_usuario_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      push_chat_mutes: {
        Row: {
          created_at: string
          plan_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          plan_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          plan_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_chat_mutes_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "planes"
            referencedColumns: ["id"]
          },
        ]
      }
      push_dispatch_usage: {
        Row: {
          request_count: number
          updated_at: string
          user_id: string
          window_started_at: string
        }
        Insert: {
          request_count?: number
          updated_at?: string
          user_id: string
          window_started_at?: string
        }
        Update: {
          request_count?: number
          updated_at?: string
          user_id?: string
          window_started_at?: string
        }
        Relationships: []
      }
      push_message_deliveries: {
        Row: {
          accepted_at: string | null
          attempts: number
          expo_ticket_id: string | null
          last_error: string | null
          message_id: string
          processing_started_at: string | null
          push_token: string
          sender_id: string
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          attempts?: number
          expo_ticket_id?: string | null
          last_error?: string | null
          message_id: string
          processing_started_at?: string | null
          push_token: string
          sender_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          attempts?: number
          expo_ticket_id?: string | null
          last_error?: string | null
          message_id?: string
          processing_started_at?: string | null
          push_token?: string
          sender_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_message_dispatches: {
        Row: {
          dispatched_at: string
          message_id: string
          sender_id: string
        }
        Insert: {
          dispatched_at?: string
          message_id: string
          sender_id: string
        }
        Update: {
          dispatched_at?: string
          message_id?: string
          sender_id?: string
        }
        Relationships: []
      }
      push_notification_outbox: {
        Row: {
          actor_id: string
          attempts: number
          available_at: string
          created_at: string
          event_key: string
          event_type: string
          expo_ticket_ids: Json | null
          id: string
          last_error: string | null
          plan_id: string
          plan_title: string
          processing_started_at: string | null
          recipient_id: string
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          actor_id: string
          attempts?: number
          available_at?: string
          created_at?: string
          event_key: string
          event_type: string
          expo_ticket_ids?: Json | null
          id?: string
          last_error?: string | null
          plan_id: string
          plan_title: string
          processing_started_at?: string | null
          recipient_id: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          actor_id?: string
          attempts?: number
          available_at?: string
          created_at?: string
          event_key?: string
          event_type?: string
          expo_ticket_ids?: Json | null
          id?: string
          last_error?: string | null
          plan_id?: string
          plan_title?: string
          processing_started_at?: string | null
          recipient_id?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_tokens: {
        Row: {
          id: string
          platform: string | null
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          id?: string
          platform?: string | null
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          id?: string
          platform?: string | null
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      reportes_planes: {
        Row: {
          creado_en: string
          estado: string
          id: string
          mensaje: string | null
          motivo: string
          notas_internas: string | null
          plan_eliminado: boolean
          plan_eliminado_en: string | null
          plan_id: string | null
          plan_titulo: string | null
          reportador_id: string
          revisado_en: string | null
          revisado_por: string | null
        }
        Insert: {
          creado_en?: string
          estado?: string
          id?: string
          mensaje?: string | null
          motivo?: string
          notas_internas?: string | null
          plan_eliminado?: boolean
          plan_eliminado_en?: string | null
          plan_id?: string | null
          plan_titulo?: string | null
          reportador_id: string
          revisado_en?: string | null
          revisado_por?: string | null
        }
        Update: {
          creado_en?: string
          estado?: string
          id?: string
          mensaje?: string | null
          motivo?: string
          notas_internas?: string | null
          plan_eliminado?: boolean
          plan_eliminado_en?: string | null
          plan_id?: string | null
          plan_titulo?: string | null
          reportador_id?: string
          revisado_en?: string | null
          revisado_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reportes_planes_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "planes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reportes_planes_reportador_id_fkey"
            columns: ["reportador_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reportes_planes_revisado_por_fkey"
            columns: ["revisado_por"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reportes_usuarios: {
        Row: {
          creado_en: string
          denunciado_id: string
          estado: string
          id: string
          mensaje: string | null
          motivo: string
          notas_internas: string | null
          reportador_id: string
          revisado_en: string | null
          revisado_por: string | null
        }
        Insert: {
          creado_en?: string
          denunciado_id: string
          estado?: string
          id?: string
          mensaje?: string | null
          motivo?: string
          notas_internas?: string | null
          reportador_id: string
          revisado_en?: string | null
          revisado_por?: string | null
        }
        Update: {
          creado_en?: string
          denunciado_id?: string
          estado?: string
          id?: string
          mensaje?: string | null
          motivo?: string
          notas_internas?: string | null
          reportador_id?: string
          revisado_en?: string | null
          revisado_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reportes_usuarios_denunciado_id_fkey"
            columns: ["denunciado_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reportes_usuarios_reportador_id_fkey"
            columns: ["reportador_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reportes_usuarios_revisado_por_fkey"
            columns: ["revisado_por"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      valoraciones: {
        Row: {
          actualizado_en: string
          asistencia: boolean | null
          aspectos_negativos: string[]
          aspectos_positivos: string[]
          creado_en: string
          detalle_otro_seguridad: string | null
          evaluado_id: string
          evaluador_id: string
          id: string
          incidencia_seguridad: boolean
          motivos_seguridad: string[]
          plan_id: string
          puntuacion_general: number | null
          repetiria_experiencia: string | null
        }
        Insert: {
          actualizado_en?: string
          asistencia?: boolean | null
          aspectos_negativos?: string[]
          aspectos_positivos?: string[]
          creado_en?: string
          detalle_otro_seguridad?: string | null
          evaluado_id: string
          evaluador_id: string
          id?: string
          incidencia_seguridad?: boolean
          motivos_seguridad?: string[]
          plan_id: string
          puntuacion_general?: number | null
          repetiria_experiencia?: string | null
        }
        Update: {
          actualizado_en?: string
          asistencia?: boolean | null
          aspectos_negativos?: string[]
          aspectos_positivos?: string[]
          creado_en?: string
          detalle_otro_seguridad?: string | null
          evaluado_id?: string
          evaluador_id?: string
          id?: string
          incidencia_seguridad?: boolean
          motivos_seguridad?: string[]
          plan_id?: string
          puntuacion_general?: number | null
          repetiria_experiencia?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "val_evaluado_fk"
            columns: ["evaluado_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "val_evaluador_fk"
            columns: ["evaluador_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "val_plan_fk"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "planes"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      actualizar_estadisticas_usuario: {
        Args: { v_usuario: string }
        Returns: undefined
      }
      admin_ban_user: {
        Args: { banned?: boolean; motivo?: string; target_id: string }
        Returns: undefined
      }
      admin_delete_inbox_item: {
        Args: { item_id: string; item_kind: string }
        Returns: undefined
      }
      admin_delete_plan: {
        Args: { target_plan_id: string }
        Returns: undefined
      }
      admin_delete_user: { Args: { target_id: string }; Returns: undefined }
      admin_moderation_counts: { Args: never; Returns: Json }
      admin_set_report_estado: {
        Args: {
          notas?: string
          nuevo_estado: string
          report_id: string
          report_kind: string
        }
        Returns: undefined
      }
      admin_set_ticket_estado: {
        Args: { notas?: string; nuevo_estado: string; ticket_id: string }
        Returns: undefined
      }
      archive_all_ended_plans: { Args: never; Returns: number }
      archive_ended_plan: { Args: { p_plan_id: string }; Returns: undefined }
      array_text_sin_duplicados: {
        Args: { valores: string[] }
        Returns: boolean
      }
      borrar_propia_cuenta: { Args: never; Returns: undefined }
      change_username: { Args: { new_name: string }; Returns: Json }
      claim_push_message: {
        Args: { p_message_id: string; p_sender_id: string }
        Returns: boolean
      }
      claim_push_message_delivery: {
        Args: {
          p_message_id: string
          p_push_token: string
          p_sender_id: string
        }
        Returns: boolean
      }
      claim_push_outbox_event: {
        Args: { p_event_id: string }
        Returns: {
          actor_id: string
          attempts: number
          available_at: string
          created_at: string
          event_key: string
          event_type: string
          expo_ticket_ids: Json | null
          id: string
          last_error: string | null
          plan_id: string
          plan_title: string
          processing_started_at: string | null
          recipient_id: string
          sent_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "push_notification_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_push_message_delivery: {
        Args: {
          p_error?: string
          p_message_id: string
          p_push_token: string
          p_sender_id: string
          p_succeeded: boolean
          p_ticket_id?: string
        }
        Returns: undefined
      }
      complete_push_outbox_event: {
        Args: {
          p_error?: string
          p_event_id: string
          p_succeeded: boolean
          p_ticket_ids?: Json
        }
        Returns: undefined
      }
      consume_ai_search_quota: { Args: never; Returns: boolean }
      consume_push_dispatch_quota: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      count_user_active_plans: { Args: { p_user_id: string }; Returns: number }
      create_meetup_plan: {
        Args: { p_payload: Json }
        Returns: {
          actualizado_en: string
          categoria: string
          chat_eliminado_en: string | null
          creado_en: string
          creador_id: string
          descripcion: string | null
          estado: Database["public"]["Enums"]["tipo_estado_plan"]
          fecha_evento: string
          finalizado_en: string | null
          id: string
          imagen_url: string | null
          is_direct_chat: boolean | null
          is_group_chat: boolean | null
          latitud: number | null
          longitud: number | null
          maximo_participantes: number
          minimo_participantes: number
          modo_privado: boolean
          nombre_ubicacion: string | null
          requiere_aprobacion: boolean
          solo_amigos: boolean
          solo_chicas: boolean
          tipo_deporte: string | null
          titulo: string
        }
        SetofOptions: {
          from: "*"
          to: "planes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_user_banned: { Args: never; Returns: boolean }
      day_start_madrid: { Args: never; Returns: string }
      delete_own_account: { Args: never; Returns: undefined }
      get_badge_stats: { Args: { p_user_id: string }; Returns: Json }
      get_chat_summaries: {
        Args: { p_direct_read_at?: Json; p_plan_read_at?: Json }
        Returns: {
          category: string
          chat_deleted_at: string
          conversation_id: string
          conversation_kind: string
          created_at: string
          creator_id: string
          event_at: string
          image_url: string
          last_at: string
          last_content: string
          last_sender_id: string
          last_sender_name: string
          last_type: string
          title: string
          unread_count: number
        }[]
      }
      get_due_push_outbox_event_ids: {
        Args: { p_limit?: number }
        Returns: {
          id: string
        }[]
      }
      get_login_email_by_username: {
        Args: { p_username: string }
        Returns: string
      }
      get_user_public_stats: { Args: { p_user_id: string }; Returns: Json }
      guardar_valoracion: {
        Args: {
          p_asistencia: boolean
          p_aspectos_negativos?: Json
          p_aspectos_positivos?: Json
          p_evaluado_id: string
          p_plan_id: string
          p_puntuacion_general?: number
          p_repetiria_experiencia?: string
        }
        Returns: Json
      }
      invoke_push_outbox_dispatcher: { Args: never; Returns: undefined }
      is_email_taken: { Args: { check_email: string }; Returns: boolean }
      is_owner: { Args: never; Returns: boolean }
      is_requesting_user_active: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      is_username_taken: {
        Args: { check_name: string; exclude_id?: string }
        Returns: boolean
      }
      nombre_usuario_ya_tomado: {
        Args: { check_name: string; exclude_id?: string }
        Returns: boolean
      }
      not_banned: { Args: never; Returns: boolean }
      plan_is_feed_public: { Args: { p_plan_id: string }; Returns: boolean }
      promote_waitlist: { Args: { p_plan_id: string }; Returns: undefined }
      purge_expired_plan_chats: { Args: never; Returns: number }
      purge_past_saved_plans: { Args: never; Returns: number }
      recalcular_badge_categorias: {
        Args: { p_usuario: string }
        Returns: undefined
      }
      recalcular_estadisticas_usuario: {
        Args: { p_usuario_id: string }
        Returns: undefined
      }
      recalcular_estadisticas_valoraciones: {
        Args: { p_usuario: string }
        Returns: undefined
      }
      recalcular_numero_amistades: {
        Args: { p_usuario: string }
        Returns: undefined
      }
      recalcular_personas_distintas: {
        Args: { p_usuario: string }
        Returns: undefined
      }
      recalcular_planes_creados: {
        Args: { p_usuario: string }
        Returns: undefined
      }
      user_can_view_plan: {
        Args: { p_plan_id: string; p_user_id?: string }
        Returns: boolean
      }
      user_has_plan_invite: {
        Args: { p_plan_id: string; p_user_id: string }
        Returns: boolean
      }
      users_are_friends: { Args: { a: string; b: string }; Returns: boolean }
      usuario_es_miembro_del_plan: {
        Args: { p_plan_id: string }
        Returns: boolean
      }
      usuario_pertenece_al_plan: {
        Args: { p_plan_id: string; p_usuario_id: string }
        Returns: boolean
      }
    }
    Enums: {
      tipo_asistencia: "asistio" | "no_asistio" | "asistio_parcialmente"
      tipo_comunicacion:
        | "muy_facil"
        | "facil"
        | "normal"
        | "dificil"
        | "muy_dificil"
      tipo_convivencia:
        | "totalmente_comodo"
        | "bastante_comodo"
        | "normal"
        | "poco_comodo"
        | "incomodo"
      tipo_deporte:
        | "futbol"
        | "baloncesto"
        | "padel"
        | "tenis"
        | "running"
        | "senderismo"
        | "otro"
      tipo_estado_amistad: "pendiente" | "aceptado" | "rechazado"
      tipo_estado_participante:
        | "pendiente"
        | "aceptado"
        | "rechazado"
        | "lista_espera"
        | "en_espera"
      tipo_estado_plan:
        | "abierto"
        | "completo"
        | "en_curso"
        | "finalizado"
        | "cancelado"
      tipo_genero:
        | "masculino"
        | "femenino"
        | "no_binario"
        | "otro"
        | "prefiero_no_decirlo"
      tipo_mensaje: "texto" | "audio" | "imagen"
      tipo_repetir: "si" | "indiferente" | "no"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      tipo_asistencia: ["asistio", "no_asistio", "asistio_parcialmente"],
      tipo_comunicacion: [
        "muy_facil",
        "facil",
        "normal",
        "dificil",
        "muy_dificil",
      ],
      tipo_convivencia: [
        "totalmente_comodo",
        "bastante_comodo",
        "normal",
        "poco_comodo",
        "incomodo",
      ],
      tipo_deporte: [
        "futbol",
        "baloncesto",
        "padel",
        "tenis",
        "running",
        "senderismo",
        "otro",
      ],
      tipo_estado_amistad: ["pendiente", "aceptado", "rechazado"],
      tipo_estado_participante: [
        "pendiente",
        "aceptado",
        "rechazado",
        "lista_espera",
        "en_espera",
      ],
      tipo_estado_plan: [
        "abierto",
        "completo",
        "en_curso",
        "finalizado",
        "cancelado",
      ],
      tipo_genero: [
        "masculino",
        "femenino",
        "no_binario",
        "otro",
        "prefiero_no_decirlo",
      ],
      tipo_mensaje: ["texto", "audio", "imagen"],
      tipo_repetir: ["si", "indiferente", "no"],
    },
  },
} as const

