import { useCallback, useEffect, useRef, useState } from 'react';
import { api, messageOf } from './api';
import type { Course, DocumentRecord, KnowledgePoint, StuckPoint } from '../shared/types';
export interface CourseDetail {
  course: Course;
  documents: DocumentRecord[];
  points: KnowledgePoint[];
  stuck: StuckPoint[];
}
export function useCourseDetail(courseId: string | null) {
  const [detail, setDetail] = useState<CourseDetail | null>(null),
    [error, setError] = useState('');
  const latestCourseId = useRef(courseId);
  latestCourseId.current = courseId;
  const refresh = useCallback(async () => {
    if (!courseId) {
      setDetail(null);
      return;
    }
    try {
      const data = await api<CourseDetail>(`/courses/${courseId}/detail`);
      if (latestCourseId.current === courseId) {
        setDetail(data);
        setError('');
      }
    } catch (error) {
      if (latestCourseId.current === courseId) setError(messageOf(error));
    }
  }, [courseId]);
  useEffect(() => {
    setDetail(null);
    void refresh();
  }, [refresh]);
  const processing = Boolean(
    detail?.documents.some((doc) => ['uploaded', 'parsing', 'indexing'].includes(doc.status)),
  );
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => {
      void refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, [processing, refresh]);
  return { detail: detail?.course.id === courseId ? detail : null, error, refresh };
}
