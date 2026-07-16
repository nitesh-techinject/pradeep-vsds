import { useQuery } from "@tanstack/react-query";
import { listTeachers } from "@/services/api";
import type { TeacherListParams } from "@/types";

export function useTeachers(params: TeacherListParams = {}) {
  return useQuery({
    queryKey: ["teachers", params],
    queryFn: () => listTeachers(params),
  });
}
