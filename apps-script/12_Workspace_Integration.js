/**
 * ==============================================================================
 * ARCHIVO: 12_Workspace_Integration.gs
 * SISTEMA: BioOS v4.1 (Arquitectura SRE)
 * DESCRIPCIÓN: Pasarela de Ecosistema Workspace bajo Política SRE de Mínimo Privilegio.
 * HITO 0.7: Type Safety, Manejo de Excepciones Nativas y Tolerancia a Fallos (GCP).
 * ==============================================================================
 */

function fetchTodayCalendarEvents() {
  return executeWithResilience("Workspace_Calendar_Read", () => {
    try {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

      const calendar = CalendarApp.getDefaultCalendar();
      const events = calendar.getEvents(startOfDay, endOfDay);

      return events.map(event => ({
        title: event.getTitle(),
        start: event.getStartTime().toISOString(),
        end: event.getEndTime().toISOString(),
        durationMinutes: Math.round((event.getEndTime().getTime() - event.getStartTime().getTime()) / (1000 * 60))
      }));
    } catch (e) {
      if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("WARNING", `[CALENDAR_FAULT] Omitiendo lectura de agenda: ${e.message}`);
      return []; // Degradación grácil: devolvemos agenda vacía
    }
  });
}

function fetchRecentUnreadContext() {
  return executeWithResilience("Workspace_Gmail_Read", () => {
    try {
      // Búsqueda de los 5 hilos no leídos más recientes
      const threads = GmailApp.search('is:unread label:inbox', 0, 5);
      let contexts = [];

      threads.forEach(thread => {
        // FIX SRE: Aplicando Type Safety. getSnippet() se invoca sobre el Thread.
        contexts.push({
          subject: thread.getFirstMessageSubject(),
          snippet: thread.getSnippet()
        });
      });

      return contexts;
    } catch (e) {
      if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("WARNING", `[GMAIL_FAULT] Omitiendo contexto de correos: ${e.message}`);
      return []; // Degradación grácil: devolvemos inbox vacío
    }
  });
}

function createProactiveTask(title, notes, dueDate) {
  return executeWithResilience("Workspace_Tasks_Write", () => {
    const props = PropertiesService.getScriptProperties();
    const normalized = [title || '', notes || '', dueDate || ''].join('|').toLowerCase().trim();
    const dedupeKey = 'BIOOS_TASK_' + Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, normalized)
      .map(byte => ('0' + (byte & 0xFF).toString(16)).slice(-2)).join('').substring(0, 32);
    let reserved = false;
    try {
      executeWithMutex('SCRIPT', () => {
        if (props.getProperty(dedupeKey)) return;
        props.setProperty(dedupeKey, new Date().toISOString());
        reserved = true;
      });
      if (!reserved) {
        sendSystemTelemetry("WARNING", `[TASKS] Duplicado omitido: "${title}"`);
        return false;
      }
      const taskLists = Tasks.Tasklists.list();
      if (!taskLists.items || taskLists.items.length === 0) {
        if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("WARNING", "[TASKS] No se encontró ninguna lista de tareas activa.");
        props.deleteProperty(dedupeKey);
        return false;
      }

      const defaultListId = taskLists.items[0].id;

      Tasks.Tasks.insert({
        title: title,
        notes: notes || "Generado automáticamente por BioOS v4.1",
        due: dueDate ? new Date(dueDate).toISOString() : undefined
      }, defaultListId);

      if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("SUCCESS", `[WORKSPACE] Tarea inyectada: "${title}"`);
      return true;

    } catch (e) {
      if (reserved) props.deleteProperty(dedupeKey);
      // INTERCEPTOR SRE: Captura silenciosa si la API de GCP no está habilitada.
      // Evita colapsos en cascada y falsos positivos en el Agente SRE.
      const errorMsg = e.message.toLowerCase();
      if (errorMsg.includes("has not been used in project") || errorMsg.includes("googlejsonresponseexception") || errorMsg.includes("not enabled")) {
        if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("WARNING", `[API_DISABLED] Google Tasks API no habilitada en GCP. Tarea omitida silenciosamente: ${title}`);
        return false;
      }

      // Si el error es de otra naturaleza, lo lanzamos para análisis
      throw e;
    }
  });
}
