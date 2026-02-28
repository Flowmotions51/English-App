package com.englishapp.api;

import com.englishapp.model.Sentence;
import com.englishapp.service.CurrentUserService;
import com.englishapp.service.ListSentenceService;
import com.englishapp.service.ScheduleService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class ScheduleController {
    private final CurrentUserService currentUserService;
    private final ListSentenceService listSentenceService;
    private final ScheduleService scheduleService;

    public ScheduleController(
            CurrentUserService currentUserService,
            ListSentenceService listSentenceService,
            ScheduleService scheduleService
    ) {
        this.currentUserService = currentUserService;
        this.listSentenceService = listSentenceService;
        this.scheduleService = scheduleService;
    }

    @GetMapping("/sentences/{sentenceId}/schedule")
    public Map<String, Object> getSchedule(@PathVariable Long sentenceId) {
        listSentenceService.getSentenceByUser(sentenceId, currentUserService.getCurrentUserId());
        return scheduleService.getSchedulePayload(sentenceId);
    }

    @PutMapping("/sentences/{sentenceId}/schedule")
    public Map<String, Object> updateSchedule(
            @PathVariable Long sentenceId,
            @RequestBody @Valid UpdateScheduleRequest request
    ) {
        Sentence sentence = listSentenceService.getSentenceByUser(sentenceId, currentUserService.getCurrentUserId());
        return scheduleService.updateSchedule(
                sentence,
                request.intervalMinutes(),
                request.openEnded(),
                request.endDate()
        );
    }

    public record UpdateScheduleRequest(
            @NotEmpty List<Integer> intervalMinutes,
            @NotNull Boolean openEnded,
            LocalDate endDate
    ) {
    }
}
