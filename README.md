# Calendario OMO - versión corregida

Calendario público de coordinación para la Escuela Olegario Morales Oliva.

- Público: consulta sin iniciar sesión.
- Administrador: control total.
- Publicador: cuenta compartida para los equipos; al crear un evento selecciona el área.
- Sin alarmas ni recordatorios.
- PostgreSQL + Express + Vercel.
- El backend usa sesiones, no tokens.

## Variables de entorno en Vercel

`DATABASE_URL` o `POSTGRES_URL`
`SESSION_SECRET`
`ADMIN_NAME`
`ADMIN_EMAIL`
`ADMIN_PASSWORD`
`PUBLISHER_NAME`
`PUBLISHER_EMAIL`
`PUBLISHER_PASSWORD`

Las dos contraseñas deben tener al menos 8 caracteres. No las compartas en el chat.

Después de definir las variables, hacer un nuevo despliegue.
